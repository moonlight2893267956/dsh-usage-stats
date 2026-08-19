import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createAssistantMessage, type TokenUsage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import UsageStatsService from '../src/index.ts'
import type { UsageStatsDay, UsageStatsValue } from '../src/index.ts'

const MESSAGE = createAssistantMessage({
  content: [{ type: 'text', text: 'answer' }],
  source: { provider: 'test', model: 'test' },
})

interface StubSession {
  meta: SessionHeader
  events: SessionEvent[]
}

function header(id: string, createdAt = 1): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt, delegationDepth: 0 }
}

/** Noon on the local calendar day `offsetDays` before today (avoids day-boundary flakiness). */
function dayTime(offsetDays: number): number {
  const date = new Date()
  date.setDate(date.getDate() - offsetDays)
  date.setHours(12, 0, 0, 0)
  return date.getTime()
}

/** Local `YYYY-MM-DD` for the same day the service buckets `dayTime(offsetDays)` into. */
function dayKey(offsetDays: number): string {
  const date = new Date(dayTime(offsetDays))
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

let seq = 0
function usageEvent(time: number, usage: TokenUsage, model = 'test'): SessionEvent {
  const message = model === 'test' ? MESSAGE : createAssistantMessage({
    content: [{ type: 'text', text: 'answer' }],
    source: { provider: 'test', model },
  })
  return { type: 'assistant/message', seq: seq++, time, data: { turn: 1, step: 1, message, usage } }
}
function bareMessageEvent(time: number): SessionEvent {
  return { type: 'assistant/message', seq: seq++, time, data: { turn: 1, step: 1, message: MESSAGE } }
}
function searchEvent(time: number): SessionEvent {
  return { type: 'tool/call', seq: seq++, time, data: { turn: 1, step: 1, callId: CallId(`call-${seq}`), name: 'web_search', arguments: '{}' } }
}
function otherToolEvent(time: number): SessionEvent {
  return { type: 'tool/call', seq: seq++, time, data: { turn: 1, step: 1, callId: CallId(`call-${seq}`), name: 'read', arguments: '{}' } }
}

function stubPersistence(sessions: StubSession[]): unknown {
  return {
    list: () => Promise.resolve(sessions.map(session => session.meta)),
    readFrom: (id: SessionId, fromSeq: number) => {
      const session = sessions.find(candidate => candidate.meta.id === id)
      if (session === undefined) return Promise.reject(new Error(`unknown session '${id}'`))
      // A real log is contiguous (`events[i].seq === i`), so readFrom returns the
      // positional suffix; the service advances its cursor by the count it read.
      return Promise.resolve({ meta: session.meta, events: session.events.slice(fromSeq) })
    },
  }
}

async function mount(sessions: StubSession[]): Promise<Context> {
  const ctx = new Context()
  ctx.provide('sessionPersistence', stubPersistence(sessions))
  await ctx.plugin(UsageStatsService)
  return ctx
}

function bucketFor(value: UsageStatsValue, offsetDays: number): UsageStatsDay {
  const bucket = value.buckets.find(candidate => candidate.date === dayKey(offsetDays))
  if (bucket === undefined) {
    return { date: dayKey(offsetDays), input: 0, cacheRead: 0, output: 0, requests: 0, searches: 0, models: {} }
  }
  return bucket
}

describe('UsageStatsService', () => {
  it('aggregates usage and searches by day across sessions', async () => {
    const ctx = await mount([
      {
        meta: header('a'),
        events: [
          usageEvent(dayTime(0), { inputTokens: 100, outputTokens: 20 }),
          usageEvent(dayTime(2), { inputTokens: 10, outputTokens: 5, cacheReadTokens: 40 }),
          searchEvent(dayTime(0)),
        ],
      },
      {
        meta: header('b'),
        events: [usageEvent(dayTime(0), { inputTokens: 7, outputTokens: 3 })],
      },
    ])
    try {
      const value = await ctx.usageStats.stats({ days: 30 })
      expect(value.days).toBe(30)
      expect(value.buckets).toHaveLength(30)
      expect(bucketFor(value, 0)).toMatchObject({ input: 107, output: 23, requests: 2, searches: 1 })
      expect(bucketFor(value, 2)).toMatchObject({ input: 10, output: 5, cacheRead: 40, requests: 1, searches: 0 })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('folds cache-write tokens into input and reads cache-read separately', async () => {
    const ctx = await mount([
      {
        meta: header('a'),
        events: [usageEvent(dayTime(0), { inputTokens: 10, outputTokens: 1, cacheReadTokens: 50, cacheWriteTokens: 6 })],
      },
    ])
    try {
      const value = await ctx.usageStats.stats({ days: 7 })
      expect(bucketFor(value, 0)).toMatchObject({ input: 16, cacheRead: 50, output: 1 })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('ignores messages without usage and non-search tool calls', async () => {
    const ctx = await mount([
      {
        meta: header('a'),
        events: [bareMessageEvent(dayTime(0)), otherToolEvent(dayTime(0))],
      },
    ])
    try {
      const value = await ctx.usageStats.stats({ days: 7 })
      expect(bucketFor(value, 0)).toMatchObject({ input: 0, cacheRead: 0, output: 0, requests: 0, searches: 0 })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('folds only newly appended events on repeat queries', async () => {
    const session: StubSession = { meta: header('a'), events: [usageEvent(dayTime(0), { inputTokens: 10, outputTokens: 1 })] }
    const ctx = await mount([session])
    try {
      const first = await ctx.usageStats.stats({ days: 7 })
      expect(bucketFor(first, 0)).toMatchObject({ input: 10, output: 1 })
      session.events.push(usageEvent(dayTime(0), { inputTokens: 5, outputTokens: 2 }), searchEvent(dayTime(0)))
      const second = await ctx.usageStats.stats({ days: 7 })
      expect(bucketFor(second, 0)).toMatchObject({ input: 15, output: 3, requests: 2, searches: 1 })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('re-derives the aggregate from the logs for a fresh instance', async () => {
    const sessions: StubSession[] = [
      { meta: header('a'), events: [usageEvent(dayTime(1), { inputTokens: 42, outputTokens: 8 }), searchEvent(dayTime(1))] },
    ]
    const first = await mount(sessions)
    await first.usageStats.stats({ days: 7 })
    await first.fiber.dispose()

    const second = await mount(sessions)
    try {
      const value = await second.usageStats.stats({ days: 7 })
      expect(bucketFor(value, 1)).toMatchObject({ input: 42, output: 8, searches: 1 })
    } finally {
      await second.fiber.dispose()
    }
  })

  it('clamps the requested window to the protocol range', async () => {
    const ctx = await mount([])
    try {
      await expect(ctx.usageStats.stats({ days: 0 })).resolves.toMatchObject({ days: 1 })
      await expect(ctx.usageStats.stats({ days: Number.NaN })).resolves.toMatchObject({ days: 30 })
      await expect(ctx.usageStats.stats({ days: 99999 })).resolves.toMatchObject({ days: 370 })
      const empty = await ctx.usageStats.stats({ days: 7 })
      expect(empty.buckets).toHaveLength(7)
      expect(bucketFor(empty, 0)).toMatchObject({ input: 0, cacheRead: 0, output: 0, searches: 0 })
      expect(empty.models).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('splits per-day totals by model and reports the window model list', async () => {
    const ctx = await mount([
      {
        meta: header('a'),
        events: [
          usageEvent(dayTime(0), { inputTokens: 100, outputTokens: 20 }, 'deepseek-reasoner'),
          usageEvent(dayTime(0), { inputTokens: 200, outputTokens: 40 }, 'deepseek-chat'),
        ],
      },
      {
        meta: header('b'),
        events: [usageEvent(dayTime(1), { inputTokens: 7, outputTokens: 3 }, 'deepseek-chat')],
      },
    ])
    try {
      const value = await ctx.usageStats.stats({ days: 30 })
      expect(bucketFor(value, 0).models).toEqual({
        'deepseek-reasoner': { input: 100, cacheRead: 0, output: 20, requests: 1 },
        'deepseek-chat': { input: 200, cacheRead: 0, output: 40, requests: 1 },
      })
      expect(bucketFor(value, 1).models).toEqual({
        'deepseek-chat': { input: 7, cacheRead: 0, output: 3, requests: 1 },
      })
      expect([...value.models].sort()).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('filters the aggregate to the requested models only', async () => {
    const ctx = await mount([
      {
        meta: header('a'),
        events: [
          usageEvent(dayTime(0), { inputTokens: 100, outputTokens: 20 }, 'deepseek-reasoner'),
          usageEvent(dayTime(0), { inputTokens: 200, outputTokens: 40 }, 'deepseek-chat'),
        ],
      },
    ])
    try {
      const value = await ctx.usageStats.stats({ days: 30, models: ['deepseek-reasoner'] })
      const bucket = bucketFor(value, 0)
      expect(bucket).toMatchObject({ input: 100, output: 20 })
      expect(bucket.models).toEqual({
        'deepseek-reasoner': { input: 100, cacheRead: 0, output: 20, requests: 1 },
      })
      expect(bucket.models['deepseek-chat']).toBeUndefined()
      // The window model list always reports every model, not just the filtered ones,
      // so the dropdown never shrinks to only the selected models.
      expect([...value.models].sort()).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

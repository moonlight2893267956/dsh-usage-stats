import { describe, expect, it, vi, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, createAssistantMessage, type TokenUsage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionPersistenceRevision, type SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import {
  apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import UsageStatsService from '../src/index.ts'
import type { UsageStatsDay, UsageStatsValue } from '../src/index.ts'

const MESSAGE = createAssistantMessage({
  content: [{ type: 'text', text: 'answer' }],
  source: { provider: 'test', model: 'test' },
})

interface StubSession {
  meta: SessionHeader
  events: SessionEvent[]
  readError?: Error
}

function header(id: string, createdAt = 1): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt, isSeeded: false, delegationDepth: 0 }
}

/** Noon on the local calendar day `offsetDays` before today (avoids day-boundary flakiness). */
function dayTime(offsetDays: number): number {
  const date = new Date()
  date.setDate(date.getDate() - offsetDays)
  date.setHours(12, 0, 0, 0)
  return date.getTime()
}

/** `offsetDays` before today at a specific hour (minute/second/ms zeroed). */
function dayAtHour(offsetDays: number, hour: number): number {
  const date = new Date()
  date.setDate(date.getDate() - offsetDays)
  date.setHours(hour, 0, 0, 0)
  return date.getTime()
}

/** Today at a specific hour (minute/second/ms zeroed). */
function todayAtHour(hour: number): number {
  const date = new Date()
  date.setHours(hour, 0, 0, 0)
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
  return { type: 'assistant/message', seq: SessionSeq(seq++), time, surfaceOp: 'append', data: { turn: 1, step: 1, message, stream: [], usage } }
}
function bareMessageEvent(time: number): SessionEvent {
  return { type: 'assistant/message', seq: SessionSeq(seq++), time, surfaceOp: 'append', data: { turn: 1, step: 1, message: MESSAGE, stream: [] } }
}
function searchEvent(time: number): SessionEvent {
  return { type: 'tool/call', seq: SessionSeq(seq++), time, data: { turn: 1, step: 1, callId: ToolCallId(`call-${seq}`), name: 'web_search', arguments: '{}' } }
}
function otherToolEvent(time: number): SessionEvent {
  return { type: 'tool/call', seq: SessionSeq(seq++), time, data: { turn: 1, step: 1, callId: ToolCallId(`call-${seq}`), name: 'read', arguments: '{}' } }
}

function stubPersistence(
  sessions: StubSession[],
  openCalls?: { value: number },
  listCalls?: { value: number },
): unknown {
  // Revision tracks each session's event count, mirroring a real backend whose
  // stat-derived revision (dev/ino/size/mtime/ctime) advances on every append
  // and stays put while the log does not change.
  const snapshots = (): SessionPersistenceSnapshot[] =>
    sessions.map(session => ({
      header: session.meta,
      revision: SessionPersistenceRevision(`${session.meta.id}:${session.events.length}`),
    }))
  return {
    list: () => {
      if (listCalls !== undefined) listCalls.value += 1
      return Promise.resolve(snapshots())
    },
    stat: (id: SessionId) => Promise.resolve(snapshots().find(snapshot => snapshot.header.id === id)),
    open: (id: SessionId, access: 'read' | 'write') => {
      if (openCalls !== undefined) openCalls.value += 1
      expect(access).toBe('read')
      const session = sessions.find(candidate => candidate.meta.id === id)
      if (session === undefined) return Promise.reject(new Error(`unknown session '${id}'`))
      if (session.readError !== undefined) return Promise.reject(session.readError)
      return Promise.resolve({
        // Mirror the real SessionHandle contract: the handle always carries the
        // exact fork-inherited prefix length (0 for an unseeded session).
        inheritedEventCount: 0,
        read: (offset = 0) => Promise.resolve({ events: session.events.slice(offset) }),
        close: () => Promise.resolve(),
      })
    },
  }
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface MountOptions {
  /** Shared json-backend root so two mounts observe the same persisted checkpoint. */
  root?: string
  /** Mutated by each persistence `open`, to assert how many logs were read. */
  openCalls?: { value: number }
  /** Mutated by each full catalog scan. */
  listCalls?: { value: number }
}

async function mount(sessions: StubSession[], options: MountOptions = {}): Promise<Context> {
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'dsh-usage-stats-'))
  if (options.root === undefined) roots.push(root)
  const ctx = new Context()
  ctx.provide('sessionPersistence', stubPersistence(sessions, options.openCalls, options.listCalls))
  await ctx.plugin(Storage)
  await ctx.plugin({ name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }, { root })
  await ctx.plugin(
    { name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig },
    { backend: 'json' },
  )
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

/** The sole bucket of a single-day (`date`) stats result, which is always present. */
function onlyBucket(value: UsageStatsValue): UsageStatsDay {
  return value.buckets[0] ?? { date: 'unknown', input: 0, cacheRead: 0, output: 0, requests: 0, searches: 0, models: {} }
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
      expect(bucketFor(value, 2)).toMatchObject({ input: 50, output: 5, cacheRead: 40, requests: 1, searches: 0 })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('folds cache-read hits into input and excludes cache-write', async () => {
    const ctx = await mount([
      {
        meta: header('a'),
        events: [usageEvent(dayTime(0), { inputTokens: 10, outputTokens: 1, cacheReadTokens: 50, cacheWriteTokens: 6 })],
      },
    ])
    try {
      const value = await ctx.usageStats.stats({ days: 7 })
      // input = uncached (10) + cache-read hits (50); cache-write (6) is excluded.
      expect(bucketFor(value, 0)).toMatchObject({ input: 60, cacheRead: 50, output: 1 })
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
      await ctx.emit('session/flush', { id: session.meta.id } as never)
      const second = await ctx.usageStats.stats({ days: 7 })
      expect(bucketFor(second, 0)).toMatchObject({ input: 15, output: 3, requests: 2, searches: 1 })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('skips unreadable session logs while aggregating readable sessions', async () => {
    const ctx = await mount([
      {
        meta: header('corrupt'),
        events: [],
        readError: new Error('corrupt session log: seq gap in committed region at line 5 (expected 4, got 3)'),
      },
      {
        meta: header('readable'),
        events: [usageEvent(dayTime(0), { inputTokens: 13, outputTokens: 7 }), searchEvent(dayTime(0))],
      },
    ])
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    try {
      const value = await ctx.usageStats.stats({ days: 7 })
      expect(bucketFor(value, 0)).toMatchObject({ input: 13, output: 7, requests: 1, searches: 1 })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('usage-stats: skipped session "corrupt"'))

      await ctx.usageStats.stats({ days: 7 })
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
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

  it('includes per-hour breakdown for a single-day window', async () => {
    const ctx = await mount([
      {
        meta: header('a'),
        events: [
          usageEvent(todayAtHour(10), { inputTokens: 100, outputTokens: 20 }),
          usageEvent(todayAtHour(14), { inputTokens: 50, outputTokens: 10, cacheReadTokens: 30 }),
          searchEvent(todayAtHour(14)),
        ],
      },
    ])
    try {
      const value = await ctx.usageStats.stats({ days: 1 })
      const bucket = bucketFor(value, 0)
      expect(bucket.hours).toHaveLength(24)
      expect(bucket.hours![10]).toMatchObject({ hour: 10, input: 100, output: 20, cacheRead: 0, requests: 1, searches: 0 })
      expect(bucket.hours![14]).toMatchObject({ hour: 14, input: 80, output: 10, cacheRead: 30, requests: 1, searches: 1 })
      expect(bucket.hours![0]).toMatchObject({ hour: 0, input: 0, output: 0, cacheRead: 0, requests: 0, searches: 0 })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('omits per-hour breakdown for multi-day windows', async () => {
    const ctx = await mount([
      { meta: header('a'), events: [usageEvent(dayTime(0), { inputTokens: 10, outputTokens: 1 })] },
    ])
    try {
      const value = await ctx.usageStats.stats({ days: 7 })
      expect(bucketFor(value, 0).hours).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('filters per-hour totals to the requested models', async () => {
    const ctx = await mount([
      {
        meta: header('a'),
        events: [
          usageEvent(todayAtHour(10), { inputTokens: 100, outputTokens: 20 }, 'deepseek-reasoner'),
          usageEvent(todayAtHour(10), { inputTokens: 200, outputTokens: 40 }, 'deepseek-chat'),
        ],
      },
    ])
    try {
      const value = await ctx.usageStats.stats({ days: 1, models: ['deepseek-reasoner'] })
      const bucket = bucketFor(value, 0)
      expect(bucket.hours![10]).toMatchObject({ hour: 10, input: 100, output: 20, requests: 1 })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('reads one specific day with its full per-hour breakdown via date', async () => {
    const ctx = await mount([
      {
        meta: header('a'),
        events: [
          usageEvent(dayTime(2), { inputTokens: 100, outputTokens: 20 }),
          usageEvent(dayAtHour(2, 13), { inputTokens: 50, outputTokens: 10, cacheReadTokens: 30 }),
          searchEvent(dayTime(2)),
        ],
      },
    ])
    try {
      const value = await ctx.usageStats.stats({ days: 30, date: dayKey(2) })
      expect(value.days).toBe(1)
      expect(value.buckets).toHaveLength(1)
      const bucket = onlyBucket(value)
      expect(bucket.date).toBe(dayKey(2))
      expect(bucket).toMatchObject({ input: 180, output: 30, cacheRead: 30, requests: 2, searches: 1 })
      expect(bucket.hours).toHaveLength(24)
      expect(bucket.hours![13]).toMatchObject({ hour: 13, input: 80, output: 10, cacheRead: 30, requests: 1, searches: 0 })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('reads an unknown day as a zero bucket with full hours via date', async () => {
    const ctx = await mount([])
    try {
      const value = await ctx.usageStats.stats({ days: 7, date: '2020-01-01' })
      expect(value.days).toBe(1)
      expect(onlyBucket(value)).toMatchObject({
        date: '2020-01-01', input: 0, cacheRead: 0, output: 0, requests: 0, searches: 0,
      })
      expect(onlyBucket(value).hours).toHaveLength(24)
      expect(value.models).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('a malformed date still yields a zero bucket rather than an error', async () => {
    const ctx = await mount([])
    try {
      const value = await ctx.usageStats.stats({ days: 7, date: 'oops' })
      expect(value.days).toBe(1)
      expect(onlyBucket(value)).toMatchObject({
        date: 'oops', input: 0, cacheRead: 0, output: 0, requests: 0, searches: 0,
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('date takes precedence over days and ignores the window length', async () => {
    const ctx = await mount([
      {
        meta: header('a'),
        events: [usageEvent(dayTime(2), { inputTokens: 10, outputTokens: 1 })],
      },
    ])
    try {
      const value = await ctx.usageStats.stats({ days: 30, date: dayKey(2) })
      expect(value.days).toBe(1)
      expect(value.buckets).toHaveLength(1)
      expect(onlyBucket(value)).toMatchObject({ date: dayKey(2), input: 10, output: 1 })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('filters a specific day to the requested models via date', async () => {
    const ctx = await mount([
      {
        meta: header('a'),
        events: [
          usageEvent(dayTime(2), { inputTokens: 100, outputTokens: 20 }, 'deepseek-reasoner'),
          usageEvent(dayTime(2), { inputTokens: 200, outputTokens: 40 }, 'deepseek-chat'),
        ],
      },
    ])
    try {
      const value = await ctx.usageStats.stats({ days: 30, date: dayKey(2), models: ['deepseek-reasoner'] })
      const bucket = onlyBucket(value)
      expect(bucket).toMatchObject({ input: 100, output: 20 })
      expect(bucket.models).toEqual({
        'deepseek-reasoner': { input: 100, cacheRead: 0, output: 20, requests: 1 },
      })
      // The window model list still reports every model, not just the filtered ones.
      expect([...value.models].sort()).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('UsageStatsService checkpoint persistence', () => {
  it('does not re-enumerate the durable catalog after the first process fold', async () => {
    const listCalls = { value: 0 }
    const ctx = await mount([
      { meta: header('a'), events: [usageEvent(dayTime(1), { inputTokens: 42, outputTokens: 8 })] },
    ], { listCalls })
    try {
      await ctx.usageStats.stats({ days: 7 })
      await ctx.usageStats.stats({ days: 7 })
      expect(listCalls.value).toBe(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('cold start with no checkpoint backfills once, then skips unchanged logs', async () => {
    const sessions: StubSession[] = [
      { meta: header('a'), events: [usageEvent(dayTime(1), { inputTokens: 42, outputTokens: 8 }), searchEvent(dayTime(1))] },
    ]
    const openCalls = { value: 0 }
    const ctx = await mount(sessions, { openCalls })
    try {
      const value = await ctx.usageStats.stats({ days: 7 })
      expect(openCalls.value).toBe(1)
      expect(bucketFor(value, 1)).toMatchObject({ input: 42, output: 8, searches: 1 })
      // Unchanged revision since the last fold → the later query reads no bytes.
      await ctx.usageStats.stats({ days: 7 })
      expect(openCalls.value).toBe(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('a warm restart reads the persisted checkpoint and avoids the full scan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-stats-'))
    roots.push(root)
    const sessions: StubSession[] = [
      { meta: header('a'), events: [usageEvent(dayTime(1), { inputTokens: 42, outputTokens: 8 }), searchEvent(dayTime(1))] },
    ]
    const first = await mount(sessions, { root })
    expect(bucketFor(await first.usageStats.stats({ days: 7 }), 1)).toMatchObject({ input: 42, output: 8, searches: 1 })
    await first.fiber.dispose()

    const secondOpenCalls = { value: 0 }
    const second = await mount(sessions, { root, openCalls: secondOpenCalls })
    try {
      const value = await second.usageStats.stats({ days: 7 })
      expect(bucketFor(value, 1)).toMatchObject({ input: 42, output: 8, searches: 1 })
      // The checkpoint already covered this revision, so no log bytes are read.
      expect(secondOpenCalls.value).toBe(0)
    } finally {
      await second.fiber.dispose()
    }
  })

  it('refolds only the changed session after a restart; unchanged sessions are skipped', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-stats-'))
    roots.push(root)
    const initial: StubSession[] = [
      { meta: header('a'), events: [usageEvent(dayTime(1), { inputTokens: 20, outputTokens: 2 })] },
      { meta: header('b'), events: [usageEvent(dayTime(1), { inputTokens: 30, outputTokens: 3 })] },
    ]
    const first = await mount(initial, { root })
    await first.usageStats.stats({ days: 7 })
    await first.fiber.dispose()

    // Only session 'b' gained an event between the two processes.
    const changed: StubSession[] = [
      { meta: header('a'), events: [usageEvent(dayTime(1), { inputTokens: 20, outputTokens: 2 })] },
      {
        meta: header('b'),
        events: [
          usageEvent(dayTime(1), { inputTokens: 30, outputTokens: 3 }),
          usageEvent(dayTime(1), { inputTokens: 5, outputTokens: 1 }),
        ],
      },
    ]
    const openCalls = { value: 0 }
    const second = await mount(changed, { root, openCalls: openCalls })
    try {
      const value = await second.usageStats.stats({ days: 7 })
      // 'a' revision unchanged → skipped; 'b' advanced → folded once.
      expect(openCalls.value).toBe(1)
      expect(bucketFor(value, 1)).toMatchObject({ input: 55, output: 6, requests: 3 })
    } finally {
      await second.fiber.dispose()
    }
  })

  it('a corrupt session advances no checkpoint and is re-attempted on the next restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-usage-stats-'))
    roots.push(root)
    const sessions: StubSession[] = [
      { meta: header('corrupt'), events: [], readError: new Error('corrupt session log: seq gap') },
      { meta: header('readable'), events: [usageEvent(dayTime(1), { inputTokens: 13, outputTokens: 7 })] },
    ]
    const first = await mount(sessions, { root })
    const warn = vi.spyOn(first.logger, 'warn').mockImplementation(() => undefined)
    await first.usageStats.stats({ days: 7 })
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
    await first.fiber.dispose()

    // The corrupt lifecycle was never check-pointed, so a fresh process attempts
    // it again (re-warning) while still aggregating the readable session.
    const second = await mount(sessions, { root })
    const warn2 = vi.spyOn(second.logger, 'warn').mockImplementation(() => undefined)
    try {
      const value = await second.usageStats.stats({ days: 7 })
      expect(bucketFor(value, 1)).toMatchObject({ input: 13, output: 7, requests: 1 })
      expect(warn2).toHaveBeenCalledTimes(1)
      expect(warn2).toHaveBeenCalledWith(expect.stringContaining('usage-stats: skipped session "corrupt"'))
    } finally {
      warn2.mockRestore()
      await second.fiber.dispose()
    }
  })
})

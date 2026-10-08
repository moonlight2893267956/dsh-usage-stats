import { describe, expect, it, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, type TokenUsage } from '@deepseek-ai/dsh-llm'
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
  /** Fork-inherited prefix length; mirrors SessionHandle.inheritedEventCount. */
  inheritedEventCount?: number
}

function seededHeader(id: string, createdAt: number, isSeeded: boolean): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt, isSeeded, delegationDepth: 0 }
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

/** One assistant/message event with seq and usage, at the given time. */
function usageEvent(seq: number, time: number, usage: TokenUsage): SessionEvent {
  return { type: 'assistant/message', seq: SessionSeq(seq), time, surfaceOp: 'append', data: { turn: 1, step: 1, message: MESSAGE, stream: [], usage } }
}

function stubPersistence(sessions: StubSession[]): unknown {
  // Revision tracks each session's event count, mirroring a real backend whose
  // stat-derived revision advances on every append.
  const snapshots = (): SessionPersistenceSnapshot[] =>
    sessions.map(session => ({
      header: session.meta,
      revision: SessionPersistenceRevision(`${session.meta.id}:${session.events.length}`),
    }))
  return {
    list: () => Promise.resolve(snapshots()),
    open: (id: SessionId, access: 'read' | 'write') => {
      expect(access).toBe('read')
      const session = sessions.find(candidate => candidate.meta.id === id)
      if (session === undefined) return Promise.reject(new Error(`unknown session '${id}'`))
      return Promise.resolve({
        // Mirror the real SessionHandle contract: read returns seq >= offset, and
        // the handle carries the exact fork-inherited prefix length.
        inheritedEventCount: session.inheritedEventCount ?? 0,
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

async function mount(sessions: StubSession[]): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-usage-stats-'))
  roots.push(root)
  const ctx = new Context()
  ctx.provide('sessionPersistence', stubPersistence(sessions))
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

describe('UsageStatsService fork 去重', () => {
  it('fork 子会话不重复统计父会话的继承事件（修复前应失败，此处断言去重后的正确值）', async () => {
    const t = dayTime(0)
    // 父会话：fork 前产生 3 次 token 消耗。
    const parentEvents: SessionEvent[] = [
      usageEvent(0, t, { inputTokens: 100, outputTokens: 20 }),
      usageEvent(1, t, { inputTokens: 50, outputTokens: 5 }),
      usageEvent(2, t, { inputTokens: 10, outputTokens: 3 }),
    ]
    // fork 子会话：物理重放父的 3 条继承事件（seq 0..2，inheritedEventCount=3），
    // 之后新增自有事件（seq 3, input 7 / output 2）。
    const childEvents: SessionEvent[] = [
      usageEvent(0, t, { inputTokens: 100, outputTokens: 20 }),
      usageEvent(1, t, { inputTokens: 50, outputTokens: 5 }),
      usageEvent(2, t, { inputTokens: 10, outputTokens: 3 }),
      usageEvent(3, t, { inputTokens: 7, outputTokens: 2 }),
    ]
    const ctx = await mount([
      { meta: seededHeader('parent', 1, false), events: parentEvents },
      { meta: seededHeader('child', 2, true), events: childEvents, inheritedEventCount: 3 },
    ])
    try {
      const value = await ctx.usageStats.stats({ days: 7 })
      // 正确聚合：父 3 条 + 子新增 1 条。
      //   input   = (100+50+10) + 7        = 167
      //   output  = (20+5+3) + 2            = 30
      //   requests= 3 + 1                   = 4
      // 修复前 foldAll 从 seq 0 折叠子会话，会把继承的 3 条再算一次，
      // 得到 input=327, output=58, requests=7 —— 这正是重复统计。
      expect(bucketFor(value, 0)).toMatchObject({ input: 167, output: 30, requests: 4 })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

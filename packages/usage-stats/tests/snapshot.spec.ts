import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { SessionPersistenceRevision, type SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import Storage from '@deepseek-ai/dsh-storage'
import * as Json from '@deepseek-ai/dsh-storage-json'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import UsageStatsService from '../src/index.ts'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { USAGE_SNAPSHOT_PATH, USAGE_STATS_PATH } from '../src/route.ts'

const contexts: Context[] = []
const roots: string[] = []
const usageFibers = new WeakMap<Context, ReturnType<Context['plugin']>>()
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
function barrier() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const header = { version: SESSION_FORMAT_VERSION, id: SessionId('synthetic'), createdAt: 1, isSeeded: false, delegationDepth: 0 }
function event(seq: number, input: number): SessionEvent {
  return { type: 'assistant/message', seq: SessionSeq(seq), time: new Date().setHours(12, 0, 0, 0), surfaceOp: 'append', data: {
    turn: 1, step: seq + 1, stream: [], usage: { inputTokens: input, outputTokens: 1 },
    message: createAssistantMessage({ content: [{ type: 'text', text: 'synthetic' }], source: { provider: 'test', model: 'test' } }),
  } }
}
function persistence(events: SessionEvent[]) {
  let listCalls = 0
  let gate: ReturnType<typeof barrier> | undefined
  let entered: ReturnType<typeof barrier> | undefined
  let failure: Error | undefined
  const snapshot = (): SessionPersistenceSnapshot => ({ header, revision: SessionPersistenceRevision(String(events.length)) })
  return {
    get listCalls() { return listCalls },
    block() { gate = barrier(); entered = barrier(); return { gate, entered } },
    fail(error: Error | undefined) { failure = error },
    async list(options?: { signal?: AbortSignal }) {
      listCalls++
      entered?.resolve()
      if (gate !== undefined) await Promise.race([gate.promise, new Promise<void>((_, reject) => {
        options?.signal?.addEventListener('abort', () => { reject(options.signal?.reason) }, { once: true })
      })])
      if (failure !== undefined) throw failure
      return [snapshot()]
    },
    async stat() { if (failure !== undefined) throw failure; return snapshot() },
    async open() { return { inheritedEventCount: 0, read: async (offset: number) => ({ events: events.slice(offset) }), close: async () => {} } },
  }
}
async function mount(p: ReturnType<typeof persistence>, root: string, interval = 1000) {
  const ctx = new Context(); contexts.push(ctx)
  ctx.provide('sessionPersistence', p)
  await ctx.plugin(Storage)
  await ctx.plugin(Json, { root })
  await ctx.plugin(Domain, { backend: 'json' })
  const fiber = ctx.plugin(UsageStatsService, { refreshPollIntervalMs: interval })
  usageFibers.set(ctx, fiber)
  await fiber
  return ctx
}
async function root() { const value = await mkdtemp(join(tmpdir(), 'usage-snapshot-')); roots.push(value); return value }
const request = { days: 1 }
const total = (value: ReturnType<UsageStatsService['cachedSnapshot']>) => value.value?.buckets[0]?.input

describe('committed usage snapshots', () => {
  it('serves fast HTTP snapshots, rejects invalid reads, and unregisters both routes', async () => {
    const p = persistence([event(0, 10)]); const { gate, entered } = p.block()
    const ctx = await mount(p, await root())
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    const base = `http://127.0.0.1:${ctx.webServer.port}`
    const response = await fetch(`${base}${USAGE_SNAPSHOT_PATH}?days=1`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ value: null, freshness: 'pending' })
    await entered.promise
    expect((await fetch(`${base}${USAGE_SNAPSHOT_PATH}?days=bad`)).status).toBe(400)
    expect((await fetch(`${base}${USAGE_SNAPSHOT_PATH}?date=bad`)).status).toBe(400)
    expect((await fetch(`${base}${USAGE_SNAPSHOT_PATH}`, { method: 'POST' })).status).toBe(405)
    gate.resolve(); await ctx.usageStats.stats(request)
    expect(await (await fetch(`${base}${USAGE_STATS_PATH}?days=1`)).json()).toMatchObject({ buckets: [{ input: 10 }] })
    expect(await (await fetch(`${base}${USAGE_SNAPSHOT_PATH}?days=1`)).json()).toMatchObject({ freshness: 'ready', value: { buckets: [{ input: 10 }] } })
    await usageFibers.get(ctx)?.dispose()
    expect((await fetch(`${base}${USAGE_SNAPSHOT_PATH}?days=1`)).status).toBe(404)
    expect((await fetch(`${base}${USAGE_STATS_PATH}?days=1`)).status).toBe(404)
  })

  it('refuses polling intervals outside the configured range', async () => {
    await expect(mount(persistence([]), await root(), 249)).rejects.toThrow()
    await expect(mount(persistence([]), await root(), 10001)).rejects.toThrow()
  })
  it('returns saved totals before reconciliation completes and shares the scan', async () => {
    const path = await root(); const events = [event(0, 10)]
    const first = await mount(persistence(events), path)
    await first.usageStats.stats(request); await first.fiber.dispose()
    events.push(event(1, 5))
    const p = persistence(events); const { gate, entered } = p.block()
    const second = await mount(p, path, 250)
    const saved = second.usageStats.cachedSnapshot(request)
    expect(saved).toMatchObject({ freshness: 'pending', revision: 0, refreshPollIntervalMs: 250 })
    expect(total(saved)).toBe(10)
    await entered.promise
    expect(total(second.usageStats.cachedSnapshot(request))).toBe(10)
    const strict = second.usageStats.stats(request)
    expect(p.listCalls).toBe(1)
    gate.resolve(); await strict
    expect(second.usageStats.cachedSnapshot(request).freshness).toBe('ready')
    expect(total(second.usageStats.cachedSnapshot(request))).toBe(15)
    expect(p.listCalls).toBe(1)
  })

  it('keeps an uncached backfill pending instead of publishing an empty result', async () => {
    const p = persistence([]); const { gate, entered } = p.block()
    const ctx = await mount(p, await root())
    expect(ctx.usageStats.cachedSnapshot(request)).toMatchObject({ value: null, freshness: 'pending' })
    await entered.promise; const strict = ctx.usageStats.stats(request); gate.resolve(); await strict
    expect(ctx.usageStats.cachedSnapshot(request)).toMatchObject({ freshness: 'ready', value: { buckets: [{ input: 0 }] } })
  })

  it('retains committed totals on scan failure and retries only on explicit retry', async () => {
    const path = await root(); const events = [event(0, 10)]
    const first = await mount(persistence(events), path); await first.usageStats.stats(request); await first.fiber.dispose()
    const p = persistence(events); p.fail(new Error('scan unavailable'))
    const second = await mount(p, path)
    await expect(second.usageStats.stats(request)).rejects.toThrow('scan unavailable')
    expect(second.usageStats.cachedSnapshot(request)).toMatchObject({ freshness: 'error', error: 'scan unavailable' })
    expect(total(second.usageStats.cachedSnapshot(request))).toBe(10)
    expect(p.listCalls).toBe(1)
    p.fail(undefined); events.push(event(1, 5))
    second.usageStats.cachedSnapshot(request, true)
    await second.usageStats.stats(request)
    expect(total(second.usageStats.cachedSnapshot(request))).toBe(15)
  })

  it('does not expose partial totals or advance cursors when checkpoint saving fails', async () => {
    const path = await root(); const events = [event(0, 10)]
    const ctx = await mount(persistence(events), path)
    await ctx.usageStats.stats(request)
    const checkpoint = Reflect.get(ctx.usageStats, 'checkpoint')
    const original = checkpoint.set.bind(checkpoint)
    const entered = barrier(); const finish = barrier()
    checkpoint.set = async () => { entered.resolve(); await finish.promise; throw new Error('disk full') }
    events.push(event(1, 5)); await ctx.emit('session/flush', { id: header.id } as never)
    const failure = ctx.usageStats.stats(request)
    await entered.promise
    expect(total(ctx.usageStats.cachedSnapshot(request))).toBe(10)
    finish.resolve(); await expect(failure).rejects.toThrow('disk full')
    expect(total(ctx.usageStats.cachedSnapshot(request))).toBe(10)
    checkpoint.set = original
    await ctx.usageStats.stats(request)
    expect(total(ctx.usageStats.cachedSnapshot(request))).toBe(15)
  })

  it('preserves flushes occurring while a reconciliation is in flight', async () => {
    const events = [event(0, 10)]; const p = persistence(events); const { gate, entered } = p.block()
    const ctx = await mount(p, await root()); const run = ctx.usageStats.stats(request)
    await entered.promise; await ctx.emit('session/flush', { id: header.id } as never)
    gate.resolve(); await run
    events.push(event(1, 5)); await ctx.emit('session/flush', { id: header.id } as never)
    await ctx.usageStats.stats(request)
    expect(total(ctx.usageStats.cachedSnapshot(request))).toBe(15)
  })

  it('strict callers include a flush that arrives after joining an existing fold', async () => {
    const events = [event(0, 10)]; const ctx = await mount(persistence(events), await root())
    await ctx.usageStats.stats(request)
    const checkpoint = Reflect.get(ctx.usageStats, 'checkpoint')
    const original = checkpoint.set.bind(checkpoint)
    const entered = barrier(); const finish = barrier()
    let block = true
    checkpoint.set = async (value: unknown) => {
      if (block) { block = false; entered.resolve(); await finish.promise }
      await original(value)
    }
    events.push(event(1, 5)); await ctx.emit('session/flush', { id: header.id } as never)
    ctx.usageStats.cachedSnapshot(request)
    await entered.promise
    events.push(event(2, 7)); await ctx.emit('session/flush', { id: header.id } as never)
    const latest = ctx.usageStats.stats(request)
    finish.resolve()
    expect((await latest).buckets[0]?.input).toBe(22)
    expect(ctx.usageStats.cachedSnapshot(request).freshness).toBe('ready')
  })

  it('aborts and settles background reads before plugin disposal', async () => {
    const p = persistence([]); const { entered } = p.block(); const ctx = await mount(p, await root())
    ctx.usageStats.cachedSnapshot(request); await entered.promise
    await ctx.fiber.dispose()
    expect(() => ctx.usageStats.cachedSnapshot(request)).toThrow()
  })
})

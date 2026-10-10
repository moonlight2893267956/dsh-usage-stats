/**
 * Cross-session per-day token-usage statistics, folded from the durable
 * session logs and served to browser clients over one read-only HTTP route.
 * The log is the source of truth: every `assistant/message` carries its step's
 * token accounting and every `tool/call` names its tool, so the aggregate
 * re-derives after a restart (backfilling history) instead of depending on
 * process-local state. The fold is log-scoped, not surface-scoped — tokens a
 * later compaction hid from the model still count, because they were consumed.
 * @module @moonlight2893267956/dsh-usage-stats
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import type { DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
// Type-only: pulls the `sessionPersistence` Context merge into this program.
import type {} from '@deepseek-ai/dsh-session-persistence'
// Type-only: pulls the `webServer` Context merge into this program.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { usageStatsDomainSpec } from './spec.ts'
import type { UsageStatsCheckpoint, UsageStatsSession } from './spec.ts'
import { USAGE_STATS_PATH, USAGE_SNAPSHOT_PATH, parseUsageStatsQuery } from './route.ts'
import type { UsageStatsConfig, UsageStatsSnapshot, UsageStatsDay, UsageStatsHour, UsageStatsModelTotals, UsageStatsRequest, UsageStatsValue } from './types.ts'

export type * from './types.ts'
export { usageStatsDomainSpec } from './spec.ts'
export type { UsageStatsCheckpoint, UsageStatsSession } from './spec.ts'

/**
 * Complete one JSON response. The read is a fresh aggregate every time, so it
 * is never cacheable.
 * @param res - the response to complete.
 * @param status - HTTP status code.
 * @param payload - value serialized as the JSON body.
 */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    usageStats: UsageStatsService
  }
}

/**
 * Hard protocol ceiling on a query window (one year plus leap slack). The
 * window length is a caller input, not a deployment tuning knob, so the bound
 * stays a fixed protocol constant rather than a Config field.
 */
const MAX_DAYS = 370

/** One model's mutable token accumulator. */
interface ModelTotals {
  input: number
  cacheRead: number
  output: number
  requests: number
}

/** A zeroed model accumulator. */
function emptyModel(): ModelTotals {
  return { input: 0, cacheRead: 0, output: 0, requests: 0 }
}

/** One mutable per-hour accumulator. */
interface HourTotals {
  input: number
  cacheRead: number
  output: number
  requests: number
  searches: number
  /** Per-model token totals within this hour. */
  models: Map<string, ModelTotals>
}

/** A zeroed hour bucket. */
function emptyHour(): HourTotals {
  return { input: 0, cacheRead: 0, output: 0, requests: 0, searches: 0, models: new Map() }
}

/** One mutable per-day accumulator. */
interface DayTotals {
  input: number
  cacheRead: number
  output: number
  requests: number
  searches: number
  /** Per-model token totals; a model absent from the map has seen no tokens that day. */
  models: Map<string, ModelTotals>
  /** 24 per-hour buckets, index 0–23. */
  hours: HourTotals[]
}

/** A zeroed day bucket. */
function emptyDay(): DayTotals {
  return { input: 0, cacheRead: 0, output: 0, requests: 0, searches: 0, models: new Map(), hours: Array.from({ length: 24 }, emptyHour) }
}

/** Local calendar-day key (`YYYY-MM-DD`) for one epoch-millisecond event time. */
function dayKeyOf(time: number): string {
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Clamp a requested window to the protocol range, defaulting an unusable value to 30. */
function clampDays(days: number): number {
  const value = Number.isFinite(days) ? Math.floor(days) : 30
  return Math.max(1, Math.min(MAX_DAYS, value))
}

/** Serialize one in-memory day bucket into its persisted JSON shape (Map → plain object). */
function persistDay(day: DayTotals): UsageStatsCheckpoint['days'][string] {
  return {
    input: day.input,
    cacheRead: day.cacheRead,
    output: day.output,
    requests: day.requests,
    searches: day.searches,
    models: Object.fromEntries(day.models),
    hours: day.hours.map(hour => ({
      input: hour.input,
      cacheRead: hour.cacheRead,
      output: hour.output,
      requests: hour.requests,
      searches: hour.searches,
      models: Object.fromEntries(hour.models),
    })),
  }
}

/** Rebuild one in-memory day bucket from its persisted JSON shape (plain object → Map). */
function restoreDay(persisted: UsageStatsCheckpoint['days'][string]): DayTotals {
  return {
    input: persisted.input,
    cacheRead: persisted.cacheRead,
    output: persisted.output,
    requests: persisted.requests,
    searches: persisted.searches,
    models: new Map(Object.entries(persisted.models)),
    hours: persisted.hours.map(hour => ({
      input: hour.input,
      cacheRead: hour.cacheRead,
      output: hour.output,
      requests: hour.requests,
      searches: hour.searches,
      models: new Map(Object.entries(hour.models)),
    })),
  }
}

/** Aggregate state committed together with its fold progress. */
interface FoldState {
  days: Map<string, DayTotals>
  cursors: Map<string, number>
  revisions: Map<string, SessionPersistenceRevision>
  unreadable: Set<string>
}

/**
 * The `usageStats` service. It keeps one in-memory aggregate fed by an
 * incremental scan of the durable logs: each query folds only the events
 * appended since the previous fold (a per-lifecycle seq cursor), so the first
 * query after a restart backfills and later ones are cheap. A per-lifecycle
 * file revision skips unaffected sessions without reading their log bytes.
 *
 * The `usage_stats` checkpoint seeds the committed aggregate across restarts.
 * Strict reads await reconciliation; cached reads return the complete saved
 * aggregate while one lifecycle-owned task reconciles history. Reconciliation
 * publishes totals and cursors only after the atomic checkpoint save succeeds.
 * A lost checkpoint requires backfill; session logs remain authoritative.
 */
export class UsageStatsService extends Service {
  static inject = ['sessionPersistence', 'storageDomain']
  static Config = z.object({
    refreshPollIntervalMs: z.number().step(1).min(250).max(10000).default(1000),
  })

  /** Only complete checkpoints are visible to readers. */
  private committed: FoldState = {
    days: new Map(), cursors: new Map(), revisions: new Map(), unreadable: new Set(),
  }
  private readonly dirtySessions = new Map<SessionId, number>()
  private catalogLoaded = false
  private hasValue = false
  private publication = 0
  private lastError: string | null = null
  private closed = false
  /** One lifecycle-owned reconciliation shared by all waiters. */
  private task: { controller: AbortController; done: Promise<void> } | undefined
  private checkpoint?: DomainGlobal<UsageStatsCheckpoint>

  /**
   * @param ctx - Host context carrying persistence and storage services.
   * @param config - Validated browser refresh timing.
   */
  constructor(ctx: Context, private readonly config: UsageStatsConfig) {
    super(ctx, 'usageStats')
  }

  /**
   * Open the checkpoint domain and seed the in-memory accumulator from the
   * persisted state. A cold start (no checkpoint) seeds empty maps, so the
   * first query backfills from the logs exactly as before.
   */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(usageStatsDomainSpec)
    this.ctx.effect(() => async () => {
      this.closed = true
      const task = this.task
      task?.controller.abort()
      if (task !== undefined) {
        try { await task.done } catch (error) { /* The reconciliation reports its failure to active readers. */ }
      }
      await domain.close()
    }, 'usageStats.domainClose')
    this.checkpoint = domain.global
    const persisted = this.checkpoint.get()
    this.committed.days = new Map(Object.entries(persisted.days).map(([key, day]) => [key, restoreDay(day)]))
    this.hasValue = Object.keys(persisted.sessions).length > 0 || this.committed.days.size > 0
    for (const [key, session] of Object.entries(persisted.sessions)) {
      this.committed.cursors.set(key, session.cursor)
      this.committed.revisions.set(key, SessionPersistenceRevision(session.revision))
    }
    this.ctx.effect(() => this.ctx.on('session/flush', (session: Session) => {
      this.dirtySessions.set(session.id, (this.dirtySessions.get(session.id) ?? 0) + 1)
    }), 'usageStats.flushInvalidation')
    // A headless profile composes no web server; the aggregate still folds and
    // seeds from the checkpoint there, it just serves no route.
    this.ctx.inject(['webServer'], (scoped) => {
      for (const path of [USAGE_STATS_PATH, USAGE_SNAPSHOT_PATH]) {
        scoped.effect(() => scoped.webServer.register({
          kind: 'exact', path,
          handler: async (req, res) => { await this.serve(req, res) },
        }), `usageStats: GET ${path}`)
      }
    })
  }

  /**
   * Answer one route request. The browser half owns the query it sends, so a
   * malformed one is a client defect and reports as a plain 400 rather than a
   * silent default.
   * @param req - the HTTP request owning the query string.
   * @param res - the response this handler completes.
   */
  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET')
      sendJson(res, 405, { message: `usage-stats accepts GET, received ${String(req.method)}` })
      return
    }
    // Node always sets url on server requests; String keeps that fact local.
    const url = new URL(String(req.url), 'http://localhost')
    const parsed = parseUsageStatsQuery(url.search)
    if (!parsed.ok) {
      sendJson(res, 400, { message: parsed.message })
      return
    }
    try {
      sendJson(res, 200, url.pathname === USAGE_SNAPSHOT_PATH
        ? this.cachedSnapshot(parsed.request, url.searchParams.get('retry') === '1')
        : await this.stats(parsed.request))
    } catch (error) {
      sendJson(res, 500, { message: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Fold any newly durable events, then return either one specific day (when
   * `request.date` is set) or the trailing per-day window.
   * @param request - the requested window length (or a single `date`), plus the model filter.
   * @returns the requested day/window, oldest first.
   */
  async stats(request: UsageStatsRequest): Promise<UsageStatsValue> {
    do {
      await this.reconcile()
    } while (this.dirtySessions.size > 0)
    return this.window(request)
  }

  /**
   * Return the last committed aggregate without waiting for historical reconciliation.
   * @param request - Date/window and model selection.
   * @param retry - Explicitly retry a previous whole-query failure.
   * @returns committed data, freshness, and Host-owned polling timing.
   */
  cachedSnapshot(request: UsageStatsRequest, retry = false): UsageStatsSnapshot {
    if (this.closed) throw new Error('usage-stats is closed')
    if ((retry || this.lastError === null) && this.needsReconciliation()) {
      void this.reconcile().catch((_error: unknown) => { /* The task retains the failure for snapshot readers. */ })
    }
    return {
      value: this.hasValue ? this.window(request) : null,
      freshness: this.lastError !== null ? 'error' : this.needsReconciliation() ? 'pending' : 'ready',
      revision: this.publication,
      error: this.lastError,
      refreshPollIntervalMs: this.config.refreshPollIntervalMs,
    }
  }

  /** Build a requested view using only the committed aggregate. */
  private window(request: UsageStatsRequest): UsageStatsValue {
    if (request.date !== undefined) {
      // A single calendar day is always a one-bucket window with its full
      // per-hour breakdown. A key absent from the fold reads as a zero bucket
      // rather than an error, so a caller may pick any date.
      const seenModels = new Set<string>()
      const bucket = this.buildDayBucket(request.date, request.models, true, seenModels)
      return Object.freeze({
        days: 1,
        buckets: Object.freeze([bucket]),
        models: Object.freeze([...seenModels].sort()),
      })
    }
    const days = clampDays(request.days)
    return this.snapshot(days, request.models)
  }

  private needsReconciliation(): boolean {
    return !this.catalogLoaded || this.dirtySessions.size > 0 || this.task !== undefined
  }

  /** Share one complete reconciliation; individual waiters do not own its cancellation. */
  private reconcile(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('usage-stats is closed'))
    if (this.task !== undefined) return this.task.done
    if (!this.needsReconciliation() && this.lastError === null) return Promise.resolve()
    const controller = new AbortController()
    this.lastError = null
    const done = Promise.resolve().then(async () => {
      try {
        await this.foldAll(controller.signal)
      } catch (error: unknown) {
        if (!this.closed) this.lastError = error instanceof Error ? error.message : String(error)
        throw error
      } finally {
        this.task = undefined
      }
    })
    this.task = { controller, done }
    return done
  }

  /**
   * Fold newly durable events into the per-day totals, then write back the
   * checkpoint when anything changed.
   *
   * The first fold in a process lists the durable catalog, preserving cold
   * backfill and restart reconciliation. Later folds inspect only sessions
   * marked by the durable `session/flush` lifecycle, so reopening the Usage
   * page does not repeatedly enumerate every stored session. A session with
   * no recorded revision folds from seq 0. An unreadable log warns, skips, and
   * records its revision only in memory (never in the checkpoint), so a
   * corrupt session is re-attempted — and re-warned — on the next restart.
   */
  private async foldAll(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    let changed = false
    const dirty = new Map(this.dirtySessions)
    const snapshots = !this.catalogLoaded
      ? await this.ctx.sessionPersistence.list({ signal })
      : await this.changedSnapshots(dirty, signal)
    const state: FoldState = {
      days: new Map([...this.committed.days].map(([key, day]) => [key, restoreDay(structuredClone(persistDay(day)))])),
      cursors: new Map(this.committed.cursors),
      revisions: new Map(this.committed.revisions),
      unreadable: new Set(this.committed.unreadable),
    }
    for (const { header, revision } of snapshots) {
      signal.throwIfAborted()
      const key = `${header.id}:${header.createdAt}`
      // The revision identity covers the whole log, so an unchanged revision
      // means the cursor is already at the durable tail — no bytes to fold.
      if (state.revisions.get(key) === revision) continue
      const fromSeq = state.cursors.get(key) ?? 0
      let events: readonly SessionEvent[]
      let foldFrom = fromSeq
      try {
        const reader = await this.ctx.sessionPersistence.open(header.id, 'read', { signal })
        try {
          // Fork-inherited events replay the parent log inside this session; skip
          // them so a forked child never double-counts the tokens its parent
          // already folded. Never rewind below the live fold cursor.
          foldFrom = Math.max(fromSeq, reader.inheritedEventCount)
          events = (await reader.read(foldFrom, Number.MAX_SAFE_INTEGER, { signal })).events
        } finally {
          await reader.close()
        }
      } catch (error: unknown) {
        signal.throwIfAborted()
        this.ctx.logger.warn(`usage-stats: skipped session "${header.id}" because its log could not be read: ${String(error)}`)
        state.revisions.set(key, revision)
        state.unreadable.add(key)
        continue
      }
      let next = foldFrom
      for (const event of events) {
        signal.throwIfAborted()
        this.foldEvent(state, event)
        next += 1
      }
      state.cursors.set(key, next)
      state.revisions.set(key, revision)
      state.unreadable.delete(key)
      changed = true
    }
    signal.throwIfAborted()
    if (changed) await this.persistCheckpoint(state)
    signal.throwIfAborted()
    this.committed = state
    this.hasValue = true
    this.publication += 1
    this.catalogLoaded = true
    for (const [id, generation] of dirty) {
      if (this.dirtySessions.get(id) === generation) this.dirtySessions.delete(id)
    }
  }

  /**
   * Observe only sessions that crossed a durability barrier since the last
   * catalog reconciliation. A vanished session has no new durable events, so
   * it is omitted without changing the accumulated historical totals.
   * @param dirty - the invalidation generation sampled at fold start.
   * @returns current snapshots for still-stored dirty sessions.
   */
  private async changedSnapshots(dirty: ReadonlyMap<SessionId, number>, signal: AbortSignal) {
    const results = await Promise.allSettled([...dirty.keys()].map(id => this.ctx.sessionPersistence.stat(id, { signal })))
    const snapshots = []
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
      if (result.value !== undefined) snapshots.push(result.value)
    }
    return snapshots
  }

  /**
   * Write the checkpoint back atomically (one global `set`). Only sessions
   * that fold succeeded are recorded — an unreadable log never advances the
   * persisted cursor, so a corrupt session is re-attempted on the next restart.
   */
  private async persistCheckpoint(state: FoldState): Promise<void> {
    const sessions: Record<string, UsageStatsSession> = {}
    for (const [key, revision] of state.revisions) {
      if (state.unreadable.has(key)) continue
      sessions[key] = { cursor: state.cursors.get(key) ?? 0, revision: String(revision) }
    }
    const checkpoint: UsageStatsCheckpoint = {
      sessions,
      days: Object.fromEntries([...state.days].map(([key, day]) => [key, persistDay(day)])),
    }
    await this.checkpoint?.set(checkpoint)
  }

  /** Add one event's contribution to its day bucket. */
  private foldEvent(state: FoldState, event: SessionEvent): void {
    // Each day bucket always materializes all 24 hour buckets, so this index is
    // in range; a `?? initializer` satisfies the indexed-access type without a
    // non-null assertion.
    const hourOfDay = new Date(event.time).getHours()
    if (event.type === 'assistant/message') {
      const usage = event.data.usage
      if (usage === undefined) return
      const day = this.day(state, event.time)
      const hour = day.hours[hourOfDay] ?? (day.hours[hourOfDay] = emptyHour())
      // input = full prompt input (uncached + cache-read hits); cacheWrite is
      // excluded so `input + cacheRead` never double-counts (input already
      // contains cacheRead). cacheRead is also kept separately for the
      // hit-share display.
      day.input += usage.inputTokens + (usage.cacheReadTokens ?? 0)
      day.cacheRead += usage.cacheReadTokens ?? 0
      day.output += usage.outputTokens
      // One assistant message with usage is one model completion request.
      day.requests += 1
      hour.input += usage.inputTokens + (usage.cacheReadTokens ?? 0)
      hour.cacheRead += usage.cacheReadTokens ?? 0
      hour.output += usage.outputTokens
      hour.requests += 1
      const model = event.data.message.source.model
      const totals = day.models.get(model) ?? emptyModel()
      totals.input += usage.inputTokens + (usage.cacheReadTokens ?? 0)
      totals.cacheRead += usage.cacheReadTokens ?? 0
      totals.output += usage.outputTokens
      totals.requests += 1
      day.models.set(model, totals)
      const hourTotals = hour.models.get(model) ?? emptyModel()
      hourTotals.input += usage.inputTokens + (usage.cacheReadTokens ?? 0)
      hourTotals.cacheRead += usage.cacheReadTokens ?? 0
      hourTotals.output += usage.outputTokens
      hourTotals.requests += 1
      hour.models.set(model, hourTotals)
    } else if (event.type === 'tool/call' && event.data.name === 'web_search') {
      const day = this.day(state, event.time)
      day.searches += 1
      const hour = day.hours[hourOfDay] ?? (day.hours[hourOfDay] = emptyHour())
      hour.searches += 1
    }
  }

  /** Return the mutable bucket for one event time, creating it on first use. */
  private day(state: FoldState, time: number): DayTotals {
    const key = dayKeyOf(time)
    let day = state.days.get(key)
    if (day === undefined) {
      day = emptyDay()
      state.days.set(key, day)
    }
    return day
  }

  /** Build one frozen per-day bucket from the fold, applying the model filter and
   * collecting every model in the window for the filter control (regardless of
   * the active filter, so the dropdown never shrinks to only the selected
   * models). When `includeHours` is set the bucket carries its full 24-hour
   * breakdown; multi-day windows omit it. */
  private buildDayBucket(
    key: string,
    models: readonly string[] | null | undefined,
    includeHours: boolean,
    seenModels: Set<string>,
  ): UsageStatsDay {
    const modelFilter = models !== undefined && models !== null && models.length > 0 ? models : null
    const day = this.committed.days.get(key) ?? emptyDay()
    const modelsOut: Record<string, UsageStatsModelTotals> = {}
    let input = 0
    let cacheRead = 0
    let output = 0
    let requests = 0
    if (modelFilter === null) {
      input = day.input
      cacheRead = day.cacheRead
      output = day.output
      requests = day.requests
      for (const [model, totals] of day.models) {
        modelsOut[model] = Object.freeze({ ...totals })
        seenModels.add(model)
      }
    } else {
      for (const model of modelFilter) {
        const totals = day.models.get(model)
        if (totals === undefined) continue
        modelsOut[model] = Object.freeze({ ...totals })
        input += totals.input
        cacheRead += totals.cacheRead
        output += totals.output
        requests += totals.requests
      }
    }
    // A missing model in the fold has seen no tokens, yet the window model list
    // still reports it so the filter control stays complete.
    for (const model of day.models.keys()) {
      seenModels.add(model)
    }
    const hours: UsageStatsHour[] | undefined = includeHours
      ? day.hours.map((hour, hourIndex) => {
        let hInput = 0
        let hCacheRead = 0
        let hOutput = 0
        let hRequests = 0
        if (modelFilter === null) {
          hInput = hour.input
          hCacheRead = hour.cacheRead
          hOutput = hour.output
          hRequests = hour.requests
        } else {
          for (const model of modelFilter) {
            const totals = hour.models.get(model)
            if (totals === undefined) continue
            hInput += totals.input
            hCacheRead += totals.cacheRead
            hOutput += totals.output
            hRequests += totals.requests
          }
        }
        return Object.freeze({
          hour: hourIndex,
          input: hInput,
          cacheRead: hCacheRead,
          output: hOutput,
          requests: hRequests,
          searches: hour.searches,
        })
      })
      : undefined
    return Object.freeze({
      date: key,
      input,
      cacheRead,
      output,
      requests,
      searches: day.searches,
      models: Object.freeze(modelsOut),
      ...(hours !== undefined ? { hours } : {}),
    })
  }

  /** Build the trailing-`days` window, oldest first, as frozen lossless JSON.
   * The per-hour breakdown is included only for a single-day window (today). */
  private snapshot(days: number, models: readonly string[] | null | undefined): UsageStatsValue {
    const seenModels = new Set<string>()
    const buckets: UsageStatsDay[] = []
    const today = new Date()
    const includeHours = days === 1
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      buckets.push(this.buildDayBucket(dayKeyOf(date.getTime()), models, includeHours, seenModels))
    }
    return Object.freeze({
      days,
      buckets: Object.freeze(buckets),
      models: Object.freeze([...seenModels].sort()),
    })
  }
}

export default UsageStatsService

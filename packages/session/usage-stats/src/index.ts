/**
 * Cross-session per-day token-usage statistics, folded from the durable
 * session logs and served to clients over a Typert Remote. The log is the
 * source of truth: every `assistant/message` carries its step's token
 * accounting and every `tool/call` names its tool, so the aggregate re-derives
 * after a restart (backfilling history) instead of depending on process-local
 * state. The fold is log-scoped, not surface-scoped — tokens a later
 * compaction hid from the model still count, because they were consumed.
 * @module @deepseek-ai/dsh-usage-stats
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import type { DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
// Type-only: pulls the `sessionPersistence` Context merge into this program.
import type {} from '@deepseek-ai/dsh-session-persistence'
import { usageStatsDomainSpec } from './spec.ts'
import type { UsageStatsCheckpoint, UsageStatsSession } from './spec.ts'
import type { UsageStatsDay, UsageStatsHour, UsageStatsModelTotals, UsageStatsRequest, UsageStatsValue } from './types.ts'

export type * from './types.ts'
export { usageStatsDomainSpec } from './spec.ts'
export type { UsageStatsCheckpoint, UsageStatsSession } from './spec.ts'

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

/**
 * The `usageStats` Remote service. It keeps one in-memory aggregate fed by an
 * incremental scan of the durable logs: each query folds only the events
 * appended since the previous fold (a per-lifecycle seq cursor), so the first
 * query after a restart backfills and later ones are cheap. A per-lifecycle
 * file revision skips unaffected sessions without reading their log bytes.
 *
 * The aggregate is checkpointed into the `usage_stats` storage domain: after
 * a restart (or a repeat visit in a new process), the persisted totals and
 * per-session fold progress seed the in-memory accumulator, so a warm start
 * folds only the deltas instead of rescanning every durable log. The in-memory
 * maps stay authoritative within one process (the hot path); SQLite serves
 * restarts and repeated visits. The checkpoint is derived, never an authority:
 * a lost or stale record only costs a longer tail replay on the next cold read.
 */
export class UsageStatsService extends TypertRemoteService {
  static inject = ['sessionPersistence', 'storageDomain']

  /** Per-day totals keyed by local day. */
  private days = new Map<string, DayTotals>()
  /** Fold progress per session lifecycle (`<id>:<createdAt>` -> next unread seq). */
  private cursors = new Map<string, number>()
  /** Last attempted log revision per session lifecycle (readable AND unreadable), so a fold skips files the fold already saw. */
  private revisions = new Map<string, SessionPersistenceRevision>()
  /** Lifecycle keys whose log could not be read this process; never persisted. */
  private readonly unreadable = new Set<string>()
  /** Serialize folds so a live query never doubles a concurrent one. */
  private foldTail: Promise<void> = Promise.resolve()
  private checkpoint?: DomainGlobal<UsageStatsCheckpoint>

  /**
   * @param ctx - Host context carrying session persistence and the storage domain form.
   */
  constructor(ctx: Context) {
    super(ctx, 'usageStats')
  }

  /**
   * Open the checkpoint domain and seed the in-memory accumulator from the
   * persisted state. A cold start (no checkpoint) seeds empty maps, so the
   * first query backfills from the logs exactly as before.
   */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(usageStatsDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'usageStats.domainClose')
    this.checkpoint = domain.global
    const persisted = this.checkpoint.get()
    this.days = new Map(Object.entries(persisted.days).map(([key, day]) => [key, restoreDay(day)]))
    for (const [key, session] of Object.entries(persisted.sessions)) {
      this.cursors.set(key, session.cursor)
      this.revisions.set(key, SessionPersistenceRevision(session.revision))
    }
  }

  /**
   * Fold any newly durable events, then return the trailing per-day window.
   * @param request - the requested window length in days.
   * @returns the clamped window, oldest first.
   */
  @Remote('stats')
  async stats(request: UsageStatsRequest): Promise<UsageStatsValue> {
    const days = clampDays(request.days)
    await this.fold()
    return this.snapshot(days, request.models)
  }

  /** Queue one fold behind the previous so concurrent queries share a single scan. */
  private fold(): Promise<void> {
    const run = this.foldTail.then(() => this.foldAll())
    this.foldTail = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * Fold every session's newly durable events into the per-day totals, then
   * write back the checkpoint when anything changed.
   *
   * Sessions whose log revision is unchanged since the last fold carry no new
   * events, so they are skipped without a log read — this is the hot path for
   * a warm query, where most durable logs have not advanced between calls. A
   * session with no recorded revision (fresh lifecycle, a fresh process cold
   * start, or a log the checkpoint never advanced past) folds from seq 0,
   * preserving the cold backfill semantics. An unreadable log warns, skips,
   * and records its revision only in memory (never in the checkpoint), so a
   * corrupt session is re-attempted — and re-warned — on the next restart.
   */
  private async foldAll(): Promise<void> {
    let changed = false
    for (const { header, revision } of await this.ctx.sessionPersistence.list()) {
      const key = `${header.id}:${header.createdAt}`
      // The revision identity covers the whole log, so an unchanged revision
      // means the cursor is already at the durable tail — no bytes to fold.
      if (this.revisions.get(key) === revision) continue
      const fromSeq = this.cursors.get(key) ?? 0
      let events: readonly SessionEvent[]
      let foldFrom = fromSeq
      try {
        const reader = await this.ctx.sessionPersistence.open(header.id, 'read')
        try {
          // Fork-inherited events replay the parent log inside this session; skip
          // them so a forked child never double-counts the tokens its parent
          // already folded. Never rewind below the live fold cursor.
          foldFrom = Math.max(fromSeq, reader.inheritedEventCount)
          events = await reader.read(foldFrom)
        } finally {
          await reader.close()
        }
      } catch (error: unknown) {
        this.ctx.logger.warn(`usage-stats: skipped session "${header.id}" because its log could not be read: ${String(error)}`)
        this.revisions.set(key, revision)
        this.unreadable.add(key)
        continue
      }
      let next = foldFrom
      for (const event of events) {
        this.foldEvent(event)
        next += 1
      }
      this.cursors.set(key, next)
      this.revisions.set(key, revision)
      this.unreadable.delete(key)
      changed = true
    }
    if (changed) await this.persistCheckpoint()
  }

  /**
   * Write the checkpoint back atomically (one global `set`). Only sessions
   * that fold succeeded are recorded — an unreadable log never advances the
   * persisted cursor, so a corrupt session is re-attempted on the next restart.
   */
  private async persistCheckpoint(): Promise<void> {
    const sessions: Record<string, UsageStatsSession> = {}
    for (const [key, revision] of this.revisions) {
      if (this.unreadable.has(key)) continue
      sessions[key] = { cursor: this.cursors.get(key) ?? 0, revision: String(revision) }
    }
    const checkpoint: UsageStatsCheckpoint = {
      sessions,
      days: Object.fromEntries([...this.days].map(([key, day]) => [key, persistDay(day)])),
    }
    await this.checkpoint?.set(checkpoint)
  }

  /** Add one event's contribution to its day bucket. */
  private foldEvent(event: SessionEvent): void {
    // Each day bucket always materializes all 24 hour buckets, so this index is
    // in range; a `?? initializer` satisfies the indexed-access type without a
    // non-null assertion.
    const hourOfDay = new Date(event.time).getHours()
    if (event.type === 'assistant/message') {
      const usage = event.data.usage
      if (usage === undefined) return
      const day = this.day(event.time)
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
      if (model !== undefined) {
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
      }
    } else if (event.type === 'tool/call' && event.data.name === 'web_search') {
      const day = this.day(event.time)
      day.searches += 1
      const hour = day.hours[hourOfDay] ?? (day.hours[hourOfDay] = emptyHour())
      hour.searches += 1
    }
  }

  /** Return the mutable bucket for one event time, creating it on first use. */
  private day(time: number): DayTotals {
    const key = dayKeyOf(time)
    let day = this.days.get(key)
    if (day === undefined) {
      day = emptyDay()
      this.days.set(key, day)
    }
    return day
  }

  /** Build the trailing-`days` window, oldest first, as frozen lossless JSON. */
  private snapshot(days: number, models: readonly string[] | null | undefined): UsageStatsValue {
    const modelFilter = models !== undefined && models !== null && models.length > 0 ? models : null
    const seenModels = new Set<string>()
    const buckets: UsageStatsDay[] = []
    const today = new Date()
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      const key = dayKeyOf(date.getTime())
      const day = this.days.get(key) ?? emptyDay()
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
      // Always collect every model in the window for the filter control,
      // regardless of the active filter — so the dropdown never shrinks to
      // only the selected models.
      for (const model of day.models.keys()) {
        seenModels.add(model)
      }
      // Per-hour breakdown is only included for a single-day window (today).
      const hours: UsageStatsHour[] | undefined = days === 1
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
      buckets.push(Object.freeze({
        date: key,
        input,
        cacheRead,
        output,
        requests,
        searches: day.searches,
        models: Object.freeze(modelsOut),
        ...(hours !== undefined ? { hours } : {}),
      }))
    }
    return Object.freeze({
      days,
      buckets: Object.freeze(buckets),
      models: Object.freeze([...seenModels].sort()),
    })
  }
}

export default UsageStatsService

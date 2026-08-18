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

import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the `sessionPersistence` Context merge into this program.
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { UsageStatsDay, UsageStatsModelTotals, UsageStatsRequest, UsageStatsValue } from './types.ts'

export type * from './types.ts'

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
}

/** A zeroed model accumulator. */
function emptyModel(): ModelTotals {
  return { input: 0, cacheRead: 0, output: 0 }
}

/** One mutable per-day accumulator. */
interface DayTotals {
  input: number
  cacheRead: number
  output: number
  searches: number
  /** Per-model token totals; a model absent from the map has seen no tokens that day. */
  models: Map<string, ModelTotals>
}

/** A zeroed day bucket. */
function emptyDay(): DayTotals {
  return { input: 0, cacheRead: 0, output: 0, searches: 0, models: new Map() }
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

/**
 * The `usageStats` Remote service. It keeps one in-memory aggregate fed by an
 * incremental scan of the durable logs: each query folds only the events
 * appended since the previous fold (a per-lifecycle seq cursor), so the first
 * query after a restart backfills and later ones are cheap.
 */
export class UsageStatsService extends TypertRemoteService {
  static inject = ['sessionPersistence']

  /** Per-day totals keyed by local day. */
  private readonly days = new Map<string, DayTotals>()
  /** Fold progress per session lifecycle (`<id>:<createdAt>` -> next unread seq). */
  private readonly cursors = new Map<string, number>()
  /** Serialize folds so a live query never doubles a concurrent one. */
  private foldTail: Promise<void> = Promise.resolve()

  /**
   * @param ctx - Host context carrying session persistence.
   */
  constructor(ctx: Context) {
    super(ctx, 'usageStats')
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

  /** Fold every session's newly durable events into the per-day totals. */
  private async foldAll(): Promise<void> {
    for (const header of await this.ctx.sessionPersistence.list()) {
      const key = `${header.id}:${header.createdAt}`
      const fromSeq = this.cursors.get(key) ?? 0
      const { events } = await this.ctx.sessionPersistence.readFrom(header.id, fromSeq)
      let next = fromSeq
      for (const event of events) {
        this.foldEvent(event)
        next += 1
      }
      this.cursors.set(key, next)
    }
  }

  /** Add one event's contribution to its day bucket. */
  private foldEvent(event: SessionEvent): void {
    if (event.type === 'assistant/message') {
      const usage = event.data.usage
      if (usage === undefined) return
      const day = this.day(event.time)
      day.input += usage.inputTokens + (usage.cacheWriteTokens ?? 0)
      day.cacheRead += usage.cacheReadTokens ?? 0
      day.output += usage.outputTokens
      const model = event.data.message.source.model
      if (model !== undefined) {
        const totals = day.models.get(model) ?? emptyModel()
        totals.input += usage.inputTokens + (usage.cacheWriteTokens ?? 0)
        totals.cacheRead += usage.cacheReadTokens ?? 0
        totals.output += usage.outputTokens
        day.models.set(model, totals)
      }
    } else if (event.type === 'tool/call' && event.data.name === 'web_search') {
      this.day(event.time).searches += 1
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
      if (modelFilter === null) {
        input = day.input
        cacheRead = day.cacheRead
        output = day.output
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
        }
      }
      // Always collect every model in the window for the filter control,
      // regardless of the active filter — so the dropdown never shrinks to
      // only the selected models.
      for (const model of day.models.keys()) {
        seenModels.add(model)
      }
      buckets.push(Object.freeze({
        date: key,
        input,
        cacheRead,
        output,
        searches: day.searches,
        models: Object.freeze(modelsOut),
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

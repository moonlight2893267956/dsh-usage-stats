/**
 * Usage settings page store: one snapshot holding the trailing per-day
 * token-usage window, read from the Host's usage route. The Host stays the
 * single fact source — every load writes the window through the wire and the
 * page re-renders from the next snapshot.
 * @module @moonlight2893267956/dsh-usage-stats/client/store
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { UsageStatsDay, UsageStatsRequest, UsageStatsValue, UsageStatsSnapshot } from '../types.ts'

/**
 * The one read this store needs. A rejected promise is a transport or Host
 * failure; the store reports its message and keeps the last good buckets.
 */
export type UsageStatsFetch = (request: UsageStatsRequest, signal?: AbortSignal, retry?: boolean) => Promise<UsageStatsSnapshot | UsageStatsValue>

/** Local calendar-day key (`YYYY-MM-DD`) for now, used to seed the default
 * single-day view. */
function todayKey(): string {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Page snapshot. */
export interface UsageStatsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text. */
  error: string | null
  /** A complete view is available, including a reconciled empty view. */
  hasValue: boolean
  /** The Host is reconciling its durable catalog. */
  refreshing: boolean
  /** The selected window length in days (used only when `date` is null). */
  days: number
  /**
   * A single local calendar day (`YYYY-MM-DD`) to read, or `null` for the
   * trailing `days` window. Non-null always sketches the per-hour view; today
   * is the seeded default.
   */
  date: string | null
  /** The trailing window, oldest first. */
  buckets: readonly UsageStatsDay[]
  /** Models present in the current window, for the filter control. */
  availableModels: readonly string[]
  /** Models selected for filtering; empty means "all models". */
  selectedModels: readonly string[]
}

/** The usage settings page controller (one per settings surface). */
export class UsageStatsStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<UsageStatsState> = createSnapshotStore<UsageStatsState>({
    status: 'idle', error: null, hasValue: false, refreshing: false,
    days: 1, date: todayKey(), buckets: [], availableModels: [], selectedModels: [],
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private active: { key: string; controller: AbortController; done: Promise<void> } | undefined

  /** Stop view-owned reads and polling; a later mount can load again. */
  stop(): void {
    this.generation += 1
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.active?.controller.abort()
    this.active = undefined
  }

  /**
   * @param fetchStats - the Host usage-route reader.
   */
  constructor(private readonly fetchStats: UsageStatsFetch) {}

  /**
   * Load the current window. A failure keeps the last good buckets and
   * surfaces the error.
   * @returns nothing; the snapshot carries the outcome.
   */
  load(retry = false): Promise<void> {
    const { days, date, selectedModels } = this.store.getSnapshot()
    const request = date !== null
      ? { days: 1, date, models: selectedModels }
      : { days, models: selectedModels }
    const key = JSON.stringify(request)
    if (!retry && this.active?.key === key) return this.active.done
    this.stop()
    const generation = this.generation
    const controller = new AbortController()
    this.store.update((s) => {
      s.status = s.hasValue ? 'ready' : 'loading'
      s.refreshing = true
      s.error = null
    })
    const done = this.read(request, controller.signal, generation, retry)
    this.active = { key, controller, done }
    void done.then(() => {
      if (this.active?.done === done) this.active = undefined
    })
    return done
  }

  private async read(request: UsageStatsRequest, signal: AbortSignal, generation: number, retry: boolean): Promise<void> {
    try {
      const response = await this.fetchStats(request, signal, retry)
      if (signal.aborted || generation !== this.generation) return
      const snapshot: UsageStatsSnapshot = 'freshness' in response ? response : {
        value: response, freshness: 'ready', revision: 0, error: null, refreshPollIntervalMs: 1000,
      }
      const value = snapshot.value
      this.store.update((s) => {
        if (value !== null) {
          s.buckets = value.buckets
          s.availableModels = value.models
          s.hasValue = true
        }
        s.status = snapshot.freshness === 'error' ? 'error' : s.hasValue ? 'ready' : 'loading'
        s.error = snapshot.error
        s.refreshing = snapshot.freshness === 'pending'
      })
      if (snapshot.freshness === 'pending') {
        this.timer = setTimeout(() => {
          this.timer = undefined
          void this.load()
        }, snapshot.refreshPollIntervalMs)
      }
    } catch (error) {
      if (signal.aborted || generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.refreshing = false
        s.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Select a new window length and reload it. Entering a multi-day window
   * clears any specific-date selection.
   * @param days - the requested window length.
   */
  setDays(days: number): void {
    const snapshot = this.store.getSnapshot()
    if (snapshot.days === days && snapshot.date === null) return
    this.store.update((s) => { s.days = days; s.date = null; s.hasValue = false; s.buckets = [] })
    void this.load()
  }

  /**
   * Select one specific calendar day and reload it. Passing `null` returns to
   * the trailing-`days` window.
   * @param date - the local calendar day (`YYYY-MM-DD`), or `null` for the window.
   */
  setDate(date: string | null): void {
    if (this.store.getSnapshot().date === date) return
    this.store.update((s) => { s.date = date; if (date !== null) s.days = 1; s.hasValue = false; s.buckets = [] })
    void this.load()
  }

  /**
   * Select which models to filter by and reload. An empty selection means all
   * models.
   * @param models - the models to include, or `[]` for every model.
   */
  setModels(models: readonly string[]): void {
    const current = this.store.getSnapshot().selectedModels
    if (current.length === models.length && current.every((m, i) => m === models[i])) return
    this.store.update((s) => { s.selectedModels = models; s.hasValue = false; s.buckets = [] })
    void this.load()
  }
}

/**
 * Usage settings page store: one snapshot holding the trailing per-day
 * token-usage window, loaded from the usageStats Remote. The Host stays the
 * single fact source — every load writes the window through the wire and the
 * page re-renders from the next snapshot.
 * @module @moonlight2893267956/dsh-usage-stats/client/store
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { UsageStatsDay, UsageStatsRequest, UsageStatsValue } from '@moonlight2893267956/dsh-usage-stats/types'

/**
 * The one Remote call this store needs. The generated face wraps the value in
 * {@link RemoteResult}: a carrier failure arrives as the `ok: false` branch
 * rather than a rejection, so this store reads one envelope.
 */
export interface UsageStatsRemote {
  stats: (request: UsageStatsRequest) => Promise<RemoteResult<UsageStatsValue>>
}

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
    status: 'idle', error: null, days: 1, date: todayKey(), buckets: [], availableModels: [], selectedModels: [],
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  /**
   * @param remote - the usageStats Remote namespace.
   */
  constructor(private readonly remote: UsageStatsRemote) {}

  /**
   * Load the current window. A failure keeps the last good buckets and
   * surfaces the error.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    const { days, date, selectedModels } = this.store.getSnapshot()
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    try {
      const carried = date !== null
        ? await this.remote.stats({ days: 1, date, models: selectedModels })
        : await this.remote.stats({ days, models: selectedModels })
      if (generation !== this.generation) return
      if (!carried.ok) throw new Error(carried.error.message)
      this.store.update((s) => {
        s.status = 'ready'
        s.error = null
        s.buckets = carried.value.buckets
        s.availableModels = carried.value.models
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
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
    this.store.update((s) => { s.days = days; s.date = null })
    void this.load()
  }

  /**
   * Select one specific calendar day and reload it. Passing `null` returns to
   * the trailing-`days` window.
   * @param date - the local calendar day (`YYYY-MM-DD`), or `null` for the window.
   */
  setDate(date: string | null): void {
    if (this.store.getSnapshot().date === date) return
    this.store.update((s) => { s.date = date; if (date !== null) s.days = 1 })
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
    this.store.update((s) => { s.selectedModels = models })
    void this.load()
  }
}

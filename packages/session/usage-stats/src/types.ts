/**
 * Public request and value vocabulary for cross-session token-usage
 * statistics. Types only, so the generated Remote client consumes them without
 * importing Host runtime code.
 * @module @deepseek-ai/dsh-usage-stats/types
 */

/** One model's token totals within a single day. */
export interface UsageStatsModelTotals {
  /** Uncached input plus cache-write tokens (the prompt side that was not reused). */
  readonly input: number
  /** Cache-read tokens (prompt-cache hits — the reused prefix). */
  readonly cacheRead: number
  /** Output (completion) tokens. */
  readonly output: number
  /** Model completion requests made that day. */
  readonly requests: number
}

/** One calendar day's usage totals, aggregated across every session on this device. */
export interface UsageStatsDay {
  /** Local calendar day, `YYYY-MM-DD`. */
  readonly date: string
  /** Uncached input plus cache-write tokens (the prompt side that was not reused). */
  readonly input: number
  /** Cache-read tokens (prompt-cache hits — the reused prefix). */
  readonly cacheRead: number
  /** Output (completion) tokens. */
  readonly output: number
  /** Model completion requests made that day. */
  readonly requests: number
  /** `web_search` tool calls made that day. */
  readonly searches: number
  /** Per-model token totals for the day, keyed by model id. */
  readonly models: Readonly<Record<string, UsageStatsModelTotals>>
}

/** Read the per-day aggregate over a trailing window. */
export interface UsageStatsRequest {
  /** Trailing days to return, inclusive of today; clamped to the protocol range. */
  readonly days: number
  /**
   * Restrict the aggregate to these models. When omitted or empty the totals
   * cover every model. Model ids come from the assistant-message provenance
   * (`message.source.model`).
   */
  readonly models?: readonly string[] | null
}

/** The trailing per-day aggregate, oldest first. */
export interface UsageStatsValue {
  /** The clamped window length actually returned. */
  readonly days: number
  /** One bucket per day in the window, oldest first; a day with no usage reads as zero. */
  readonly buckets: readonly UsageStatsDay[]
  /** Every model that appears in the window, sorted for stable presentation. */
  readonly models: readonly string[]
}

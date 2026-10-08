/**
 * The `usage_stats` checkpoint domain: one global record holding the
 * cross-session token-usage aggregate derived from the durable logs, plus the
 * per-session fold progress (cursor + log revision) that makes the next fold
 * incremental across restarts. The domain is THE persisted side of the
 * in-memory accumulator — the log stays the source of truth and the checkpoint
 * is disposable derived data, so a lost or stale record costs a longer tail
 * replay on the next cold read, never a wrong value.
 * @module @moonlight2893267956/dsh-usage-stats/src/spec
 */

import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'

/** One model's zeroed-or-accumulated token totals, lossless JSON. */
export const usageStatsModelTotals = z.object({
  input: z.number(),
  cacheRead: z.number(),
  output: z.number(),
  requests: z.number(),
})

/** One hour bucket's totals, including its per-model split. */
export const usageStatsHour = z.object({
  input: z.number(),
  cacheRead: z.number(),
  output: z.number(),
  requests: z.number(),
  searches: z.number(),
  models: z.record(z.string(), usageStatsModelTotals),
})

/** One calendar day's totals, including its per-model split and 24 hour buckets. */
export const usageStatsDay = z.object({
  input: z.number(),
  cacheRead: z.number(),
  output: z.number(),
  requests: z.number(),
  searches: z.number(),
  models: z.record(z.string(), usageStatsModelTotals),
  hours: z.array(usageStatsHour).length(24),
})

/** One lifecycle's fold progress: the next seq to fold and the revision of the folded log. */
export const usageStatsSession = z.object({
  /** Next unread seq for this session lifecycle (`<id>:<createdAt>`). */
  cursor: z.number().int().nonnegative(),
  /** The session log revision that fold reached (branded as `SessionPersistenceRevision` at load). */
  revision: z.string(),
})

/** Inferred per-session fold progress. */
export type UsageStatsSession = z.infer<typeof usageStatsSession>

/**
 * The persisted checkpoint: per-session fold progress (readable sessions only —
 * unreadable logs are never recorded, so a corrupt log is re-attempted on the
 * next restart) plus the accumulated day/hour/model totals.
 */
export const usageStatsCheckpoint = z.object({
  sessions: z.record(z.string(), usageStatsSession),
  days: z.record(z.string(), usageStatsDay),
})

/** Inferred checkpoint value. */
export type UsageStatsCheckpoint = z.infer<typeof usageStatsCheckpoint>

/**
 * The `usage_stats` domain. A single global record (no tables) is deliberate:
 * the checkpoint MUST land atomically, and a lone `global.set` is one atomic
 * backend write — per-session records spread the totals and fold progress
 * across rows, so a crash between them could persist a cursor ahead of its
 * totals (a permanent under-count) or behind them (a double-count).
 *
 * The whole unit version-stamps as one: changing the checkpoint schema bumps
 * {@link usageStatsDomainSpec}.version, which the sqlite backend accepts as a
 * hard `version-mismatch` at open (it has no `backupRecord` and no per-record
 * version scope). The data is fully re-derivable from the logs, so a bump is
 * expected to be handled by clearing the unit — not by a migration.
 */
export const usageStatsDomainSpec = defineDomain({
  name: 'usage_stats',
  version: 1,
  global: {
    schema: usageStatsCheckpoint,
    initial: { sessions: {}, days: {} },
  },
  tables: {},
})

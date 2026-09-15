# Agent Note: usage-stats SQLite checkpoint

Status: implemented

English | [中文](2026-09-07-usage-stats-sqlite-checkpoint.zh.md)

## Problem

`@deepseek-ai/dsh-usage-stats` folds cross-session per-day token usage out of the durable session logs into a process-local accumulator. The fold is incremental within one process, but the accumulator is not persisted: the first `stats` call after a restart backfills by scanning every durable log once, and a fresh process, a repeat visit, or a page reload in a new process each re-pay that full scan. On a device with many large logs this is a recurring cold-backfill cost that grows with usage history rather than with what changed since the last query.

## Decision

Persist the fold into a `usage_stats` storage-domain checkpoint and route it through the SQLite backend. The in-memory `Map`s stay the hot path inside one process; the storage domain serves restarts and repeated visits.

- **One global record, no tables.** The checkpoint is a single global value holding the accumulated day/hour/model totals plus a per-session fold progress map (`<id>:<createdAt>` → `{ cursor, revision }`). A lone `global.set` is one atomic backend write; splitting totals and per-session progress across rows would let a crash persist a cursor ahead of its totals (a permanent under-count) or behind them (a double-count), so it is deliberately not per-record.
- **Open and seed at `Service.init`.** The service injects `storageDomain`; init opens the domain, registers the close effect, seeds the in-memory accumulator from the persisted global (empty on a cold start), and folds only the delta on the next `stats`.
- **Write back on a mutated fold.** After folding, when any session advanced, the checkpoint is rewritten atomically. The persisted per-session progress records only sessions that folded successfully; an unreadable log is never recorded, so a corrupt session is re-attempted (and re-warned) on the next restart — within one process it is warned once and skipped, as before.
- **Route through `storage-domain`, not `session-query-sqlite`.** The latter serves full-text search, not usage aggregation. The web composition mounts `storage-sqlite` and routes `usage_stats` to the `sqlite` backend; the row lives on the web profile, not on base, because the SQLite backend opens its database eagerly on activation. No API or UI contract changes.

## Alternatives considered

- **`session-query-sqlite` as the checkpoint medium.** Rejected: it owns a search index and an in-memory query surface, not a derived-aggregation checkpoint; reusing it would couple usage stats to search internals and its `openAt`/path lifecycle.
- **Per-record layout, one row per session.** Rejected: it loses the single atomic write. A crash between a session-row cursor write and the totals write leaves the fold progress and the totals disagreeing, and there is no cross-record transaction to reconcile them — the checkpoint is derived data that must not persist a wrong-but-stale value that never self-heals.
- **Persist only per-session cursors, recompute totals.** Rejected: it still scans every changed log to rebuild totals, so it does not remove the cold-backfill cost the checkpoint exists to avoid.
- **Keep the status quo (in-memory only).** Rejected: restarts and repeated visits keep paying the full scan.

## Consequences

- The web profile now mounts `storage-sqlite` (with `dshHomePath('storages/usage-stats.db')`) and restates `storage-domain`'s config to route `usage_stats` to `sqlite` while leaving base's `json` default for every other domain.
- The `usage_stats` domain version-stamps as one unit. The SQLite backend has no per-record version scope and no `backupRecord`; `invalidRecords: 'backup-and-skip'` therefore falls back to fail-loud there. A checkpoint schema change bumps the domain `version`, which SQLite rejects as a hard `version-mismatch` at open — recovery is a unit clear, not a migration, because the data is fully re-derivable from the logs.
- A corrupt log is re-attempted on every fresh process (it never advances the checkpoint), so an environment with a permanently corrupt log re-warns once per process rather than once ever.
- The package injects `storageDomain`; assemblies that mount `usage-stats` without the storage stack now fail loud at activation.

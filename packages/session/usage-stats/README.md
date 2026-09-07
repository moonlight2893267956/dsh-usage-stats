# @deepseek-ai/dsh-usage-stats

English | [中文](README.zh.md)

Cross-session per-day token-usage statistics, folded from the durable session logs and served to clients over a Typert Remote. The log is the source of truth: every `assistant/message` event carries its step's token accounting and every `tool/call` names its tool, so the aggregate re-derives after a restart (backfilling history) instead of depending on process-local state. The aggregate is checkpointed into the `usage_stats` storage domain, so a warm start seeds from the persisted totals and folds only the deltas instead of rescanning every durable log.

## The `usageStats` Remote

`ctx.usageStats` is a Typert remote service with one method.

### `stats(request: { days }): Promise<UsageStatsValue>`

Folds every session's newly durable events into the per-day totals, then returns the trailing `days`-long window, oldest first. Each bucket is one local calendar day:

- `input` — full prompt input: uncached input plus cache-read hits (contains `cacheRead`).
- `cacheRead` — cache-read tokens (prompt-cache hits — the reused prefix).
- `output` — output (completion) tokens.
- `searches` — `web_search` tool calls made that day.

The window length is clamped to `[1, 370]`; an unusable value defaults to 30.

### Fold semantics

- The aggregate is **log-scoped, not surface-scoped**: tokens a later compaction hid from the model still count, because they were consumed.
- The fold is **incremental**: each query folds only the events appended since the previous fold (a per-lifecycle seq cursor), so the first query after a cold start backfills and later ones are cheap. A per-lifecycle log revision skips sessions whose durable log did not advance since the last fold, so a warm query reads no unchanged log bytes at all.
- The aggregate is **checkpointed** into the `usage_stats` storage domain: a warm start (new process, populated checkpoint) seeds the in-memory totals and per-session fold state from the domain, then folds only the deltas — a cold start with no checkpoint backfills once. The checkpoint is one global record written atomically per mutated fold; the in-memory accumulator stays the hot path inside one process.
- A session deleted from the device keeps its contribution — its tokens were still consumed.
- Only the durable log is read; a live session's unflushed tail (a few recent events) lags behind until it is written.
- An unreadable session log warns, skips, and records its revision only in memory — never in the checkpoint — so a corrupt log is re-attempted (and re-warned) on the next restart.

## Composition

```yaml
- id: usage-stats
  name: '@deepseek-ai/dsh-usage-stats'
- id: storage-sqlite
  name: '@deepseek-ai/dsh-storage-sqlite'
  config:
    path: .../storages/usage-stats.db
- id: storage-domain
  config:
    backend: json
    routes:
      usage_stats: sqlite
```

Injects `sessionPersistence` (the plugin's whole purpose) and `storageDomain` (the checkpoint's storage form). The checkpoint domain routes to a backend through `storage-domain`'s `routes`; the web composition routes `usage_stats` to the SQLite backend, whose eager database open is why that row lives on the profile that mounts the plugin rather than on the shared base. Assemblies without `storageDomain` fail loud at activation, and without `sessionPersistence` the fiber stays pending.

## Model Experience

None, as the plugin only computes a client-facing read model of already-logged session events and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **One global checkpoint record** — the checkpoint is a single global value (accumulated totals plus per-session fold progress) so it lands atomically; every mutated fold rewrites the whole record. The medium is the checkpoint domain behind one storage form, so a schema change bumps the domain `version`, which the SQLite backend rejects as a hard `version-mismatch` at open (it has no per-record version scope and no `backupRecord`). The data is fully re-derivable from the logs, so recovery is a clear of the unit, not a migration.
- **Unreadable-log retry across restarts** — a corrupt log stays check-pointed only for readable sessions, so each fresh process re-attempts (and re-warns on) the corrupt log. Within one process it is warned once and skipped.
- **No per-purpose or per-model split** — buckets split by token kind (input / cache-read / output), not by call purpose (conversation / compaction / session-title) or model, because the durable `assistant/message` record does not carry the request's `purpose`. Splitting further would require logging that field first.

# @deepseek-ai/dsh-usage-stats

English | [中文](README.zh.md)

Cross-session per-day token-usage statistics, folded from the durable session logs and served to clients over a Typert Remote. The log is the source of truth: every `assistant/message` event carries its step's token accounting and every `tool/call` names its tool, so the aggregate re-derives after a restart (backfilling history) instead of depending on process-local state.

## The `usageStats` Remote

`ctx.usageStats` is a Typert remote service with one method.

### `stats(request: { days }): Promise<UsageStatsValue>`

Folds every session's newly durable events into the per-day totals, then returns the trailing `days`-long window, oldest first. Each bucket is one local calendar day:

- `input` — uncached input plus cache-write tokens (the prompt side that was not reused).
- `cacheRead` — cache-read tokens (prompt-cache hits — the reused prefix).
- `output` — output (completion) tokens.
- `searches` — `web_search` tool calls made that day.

The window length is clamped to `[1, 370]`; an unusable value defaults to 30.

### Fold semantics

- The aggregate is **log-scoped, not surface-scoped**: tokens a later compaction hid from the model still count, because they were consumed.
- The fold is **incremental**: each query folds only the events appended since the previous fold (a per-lifecycle seq cursor), so the first query after a restart backfills and later ones are cheap.
- A session deleted from the device keeps its contribution — its tokens were still consumed.
- Only the durable log is read; a live session's unflushed tail (a few recent events) lags behind until it is written.

## Composition

```yaml
- id: usage-stats
  name: '@deepseek-ai/dsh-usage-stats'
```

Injects `sessionPersistence` — the plugin's whole purpose; in assemblies without it the fiber stays pending and nothing registers.

## Model Experience

None, as the plugin only computes a client-facing read model of already-logged session events and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Cold backfill on first query after a restart** — the aggregate lives in memory, so the first `stats` call after a restart scans every durable log once; with many large logs this is a one-time cost per process. A persisted checkpoint would make restarts instant but adds a storage domain the current design deliberately avoids.
- **No per-purpose or per-model split** — buckets split by token kind (input / cache-read / output), not by call purpose (conversation / compaction / session-title) or model, because the durable `assistant/message` record does not carry the request's `purpose`. Splitting further would require logging that field first.

---
description: "Per-day token-usage totals across every session on this device, folded from the durable session logs and served to clients over one read-only HTTP route."
kind: "package-reference"
---

# @deepseek-ai/dsh-usage-stats

English | [中文](README.zh.md)

## Summary

Use this package to report how many tokens this device has spent, aggregated by day across every session rather than only the one on screen. It folds the durable session logs into per-day totals of input, cache-read, and output tokens plus web-search counts, and serves them to clients through one read-only HTTP route. Because the log is the source of truth, totals survive restarts and backfill history; a storage checkpoint makes a warm start fold only new events. Deleted sessions keep their contribution, and unreadable logs are skipped rather than failing the query.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin beside the session persistence it reads; the read route it registers then serves the Web GUI's Usage page.

### Minimal configuration

```yaml
- id: usage-stats
  name: '@deepseek-ai/dsh-usage-stats'
```

A deployment that wants the SQLite medium for the checkpoint adds both rows below; without them the `usage_stats` domain stays on the composition's default backend, which is the shared `json` one.

```yaml
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

The plugin declares no config. It injects `sessionPersistence` and `storageDomain`: without `sessionPersistence` the fiber stays pending, and without `storageDomain` activation fails loud. The shipped Web composition leaves `usage_stats` on the `json` default, because `storage-sqlite` opens its database on activation and that composition also packs the browser-only Worker deployment, whose `node:sqlite` stub refuses the constructor; routing the domain to SQLite is a later patch layer's choice.

### What the figures mean

| Field | Meaning |
|---|---|
| `input` | Full prompt input: uncached input plus cache-read hits, so it already contains `cacheRead` |
| `cacheRead` | Prompt-cache hits — the reused prefix |
| `output` | Output (completion) tokens |
| `requests` | Assistant messages carrying usage, one per model completion request |
| `searches` | `web_search` tool calls made that day |

A single-day request also carries 24 hourly buckets; a trailing window carries per-day buckets only. The window length is clamped to `[1, 370]`, and an unusable value defaults to 30.

### Fold semantics

The fold reads the durable log, not the model-visible surface, so tokens a later compaction hid from the model still count because they were consumed. The first query in a process reconciles the durable session catalog; later queries inspect only sessions that crossed a durability checkpoint, so reopening Usage does not enumerate every stored session. A per-lifecycle file revision still skips logs whose bytes did not advance.

### Failure and recovery

A query never fails because one session log is corrupt: the fold warns, skips that session, and records its revision in memory only, so a fresh process retries it. A lost or stale checkpoint costs a longer tail replay on the next cold read and never loses data, because the logs remain the authority. A session deleted from the device keeps its contribution.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`UsageStatsService` keeps one in-memory aggregate: per-day buckets keyed by local calendar day, each carrying 24 hourly buckets and a per-model map, plus a fold cursor and last-seen revision per session lifecycle. Its first fold walks `sessionPersistence.list()`; later folds inspect only sessions invalidated by `session/flush`. It skips unchanged revisions, opens each remaining log for reading, skips the fork-inherited prefix (`inheritedEventCount`) so a forked child never double-counts its parent, and folds every event after the cursor. `foldEvent` adds `assistant/message` usage to the day, hour, and model accumulators, and counts `tool/call` events named `web_search`. Folds serialize behind one promise tail, so concurrent queries share a single scan. After a mutated fold the service writes the whole checkpoint back through the `usage_stats` storage domain as one global value — accumulated totals plus per-session progress, with unreadable sessions excluded so a restart re-attempts them.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-session-persistence](../session-persistence/README.md) — the durable log store whose listings, revisions, and reads the fold consumes.
- [dsh-storage-domain](../../storage/storage-domain/README.md) — the checkpoint domain facility and its backend routes.
- [dsh-client-ui-usage](../../client/ui-usage/README.md) — the Usage settings page that renders these figures.

-----

<a id="model-experience"></a>
## Model Experience

None, as the plugin only computes a client-facing read model of already-logged session events and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the figures cover and what the checkpoint can recover. They are current package constraints.

- **One global checkpoint record** — the checkpoint is a single global value holding accumulated totals and per-session fold progress, so one mutated fold rewrites all of it. A schema change raises the domain `version`: the `json` backend backs the stale record up, while a deployment routing the domain to SQLite gets a hard `version-mismatch` at open. The totals are fully re-derivable from the logs, so recovery is clearing the unit rather than migrating it.
- **Unreadable-log retry across restarts** — only readable sessions enter the checkpoint, so each fresh process re-attempts and re-warns on a corrupt log; within one process it is warned once and skipped.
- **No per-purpose split** — buckets split by token kind and by model, but not by call purpose (conversation, compaction, session title), because the durable `assistant/message` record does not carry the request's `purpose`; splitting further requires logging that field first.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package only aggregates `assistant/message` usage records and `tool/call` names whose shapes and append-only ordering are owned and runtime-checked by dsh-session and dsh-agent-loop, and reads them through dsh-session-persistence, whose contiguity and durability are checked there; it owns no event relation of its own to assert.

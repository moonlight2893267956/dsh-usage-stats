# Usage snapshot performance evidence

## Scope

The endpoint is the first visible committed aggregate after process restart, followed by a strictly reconciled aggregate. Snapshot responses explicitly report `pending`; their latency is not equivalent to the latency of a fresh result. Model/network latency, application boot, cold OS disk cache, and full desktop paint are excluded from the Node measurements.

## Built-JavaScript diagnostic

`startup.perf.mjs` mounts the built services and real JSONL persistence/JSON checkpoint backend over a private synthetic root. It creates fixed sessions with 5 events per turn, 2048 bytes of assistant text per turn, and 4 models. Fixture setup precedes timing. Each service is disposed before reopening it, but OS caches remain warm. Every candidate committed value and final strict result is compared with the baseline. Heap figures are transient diagnostics, not retained-memory limits. This owner-local diagnostic has no CI time threshold.

Measured locally with Node 24.20.0 on macOS arm64:

| Workload | Baseline first strict read, ms | Candidate cached read, ms | Candidate reconciliation completion, ms |
|---|---|---|---|
| 32 sessions × 10 turns | 24.59 / 14.78 / 10.15 | 0.392 / 0.173 / 0.152 | 16.83 / 11.15 / 10.70 |
| 166 sessions × 20 turns | 72.33 / 64.04 / 59.70 | 0.683 / 0.154 / 0.139 | 64.80 / 61.97 / 58.59 |

The larger workload's median first-display service latency changes from 64.04 ms to 0.154 ms; strict completion changes from 64.04 ms to 61.97 ms. This is a freshness tradeoff, not a claim that reconciliation became hundreds of times faster. The candidate hot strict reads were 0.137 / 0.123 / 0.129 ms. Process heap observations were 49.13 / 61.20 / 27.90 MiB with prior samples sharing the worker; they do not establish retained-memory improvement.

An additional read-only desktop-runtime probe restored the existing checkpoint through Electron Node 24.18.1 and the App's framework modules. Its committed snapshot returned in 0.359 ms while reconciliation was blocked. It did not save, mutate logs, or prove the desktop UI timing.

## Functional and negative-control evidence

The package suite passes 60 tests. New cases include blocked reconciliation with cached totals, concurrent scan sharing, null-before-backfill, explicit retry, atomic checkpoint failure, flushes arriving while a strict waiter joins, abort/settlement before disposal, HTTP refusal/route teardown, retained chart during update, auto-refresh, superseded request cancellation, and polling teardown. The existing real Loader/persistence test and fork-counting tests remain passing.

Negative control: temporarily withholding a cached value while reconciliation was pending made `returns saved totals before reconciliation completes and shares the scan` fail (`expected undefined to be 10`). Restoring the nonblocking committed value made all 9 snapshot host tests pass. No negative-control modification remains in the source or installed artifact.

`browser-snapshot.mjs` uses real Chrome and the published `lib/client.js`, with a synthetic intercepted HTTP response and a minimal test slot carrier. It verifies cached chart plus updating label, then automatic replacement with a ready response, with no page errors. This is browser-bundle fixture evidence, not the full desktop shell or real model evidence. Screenshots belong under ignored `.playwright-mcp/`. Full desktop first-open verification remains user-owned after restarting the installed local package.

## Remaining cost and exclusions

Historical revisions can include a corpus-wide migration fingerprint. Unrelated writes can invalidate many old sessions; reopening them can trigger repeated migration catalog reads even when their usage cursor returns no new events. Cached display does not remove those reads. This change deliberately preserves opaque revision semantics, released log validation, migration rules, and the checkpoint's version 1 format. It does not move logs into a new generation or swap storage backends.

## Chart legibility and interaction

`ui-review.mjs` renders the built client bundle in real Chrome over three synthetic shapes — a sparse current day, a busy current day, and a 30-day window — and captures hover and keyboard-focus states. It found that empty buckets drew a 0.5px mark that read as blank canvas across most of the plot, and that `.barHover` had no stylesheet rule at all, so the hover highlight never applied. The chart now marks every bucket on the baseline rail at column width, sizes columns from their slot instead of a fixed 18px cap, draws the zero gridline, highlights hover and focus, and drops the cascade and hover motion under `prefers-reduced-motion`. Column height transitions on in-place data updates, while a window change still remounts and replays the cascade. Screenshots stay under ignored `.playwright-mcp/`.

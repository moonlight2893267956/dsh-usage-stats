# Agent Note: Usage stats folds both cache compartments and shows search counts

Status: implemented

English | [中文](2026-10-16-usage-stats-cache-write-and-search-count.md)

## Problem

Two defects sat on the same read path.

**Cache writes were dropped from `input`.** The fold computed prompt input as `inputTokens + cacheReadTokens`, on the stated reasoning that adding `cacheWriteTokens` would double-count. That reasoning is wrong: `TokenUsage` in `dsh-llm` declares the counts disjoint — `inputTokens` is the *uncached* prompt only, and cached input arrives separately as `cacheReadTokens`/`cacheWriteTokens`, so billed input is the sum of the three. A router that reports cache creation therefore under-counted every prompt it served. `llm-pi-ai` emits `cacheWriteTokens` whenever it is non-zero, and `llm-deepseek` maps `cache_creation_input_tokens` onto it.

**Search counts never reached the page.** `tool/call` events named `web_search` were folded into a per-day and per-hour `searches` total, persisted in the checkpoint, typed on the wire value, and accumulated in the client — then dropped: `UsageSection` summed them into a local `searches` and rendered no element for it. Both READMEs nevertheless advertised that the page reports web searches, so the documented feature was invisible.

## Decision

**Input is the complete prompt side.** `foldEvent` now accumulates `inputTokens + cacheReadTokens + cacheWriteTokens` through one named `promptInput` helper, so the contract lives in one place and the four accumulators (day, hour, per-model day, per-model hour) cannot drift apart. `cacheRead` remains a separate accumulator because the hit-share display divides by `input`.

**History is not re-folded.** The fold advances a per-session cursor, so an already-folded event is never read again; a changed accumulator therefore leaves every day already in the checkpoint on the previous arithmetic unless the unit is cleared. Clearing it would re-fold the whole corpus (19–28 s cold on this machine) and would also drop the contribution of sessions deleted from the device — a documented behaviour this package intentionally keeps. The two arithmetics therefore coexist: days folded before this change keep the old `input`, days folded after use the new one. On this machine every recorded `cacheWriteTokens` is `0`, so the visible difference is zero; the correction matters for routers that do report cache creation.

**Search counts are a subline, not a fifth card.** The requests card already carried a subline for the input hit rate, and the `.cards` grid is two columns — a fifth card would leave an odd trailing cell. The count renders unconditionally, including `0`, so the line reads as a measured value rather than disappearing.

**No schema change.** `foldEvent` writes existing fields only, so the checkpoint stays at domain version 1 and nothing is invalidated.

## Alternatives considered

**Raise the domain version so the schema states the new semantics.** Unnecessary — no field changed — and actively harmful. Both backends reject a stale unit with `version-mismatch` at open, and the JSON backend keeps the file rather than backing it up, so every plugin injecting `storageDomain` would stay pending until the user deleted `usage_stats.json` by hand. The README previously claimed the JSON backend backs the stale record up; a probe that wrote a version-1 unit and reopened it at version 2 disproved that, and the claim is corrected.

**Clear the checkpoint in place to re-fold everything.** Would correct history but silently revoke the deleted-session contribution and pay a full cold fold on the user's next open. Rejected as a silent cost imposed by a bug fix; recorded as a known limitation instead.

**Adding `cacheWrite` as its own field so the page can split it out.** Three prompt compartments are not what the chart's stack shows — it stacks input miss, cache read, and output — and the extra field would force a schema change for a distinction the UI does not draw.

**A fifth metric card for searches.** Would break the two-column grid's balance and give a `web_search` call count the same visual weight as token totals.

## Consequences

- `input` is now the true prompt-side total for newly folded events, and `input + output` is the request's whole billed total. The hit rate's denominator grows accordingly, so the reported percentage dips slightly for routers that report cache writes.
- The chart's input-miss segment (`input - cacheRead`) now includes cache writes, which is the correct reading of "prompt tokens that were not cache hits". The `输入（未命中）` copy stays accurate.
- `cacheRead`, `output`, `requests`, `searches`, `models`, and the hourly buckets are unchanged.
- The page shows the search count; the wire value and route query are unchanged, since `searches` was already typed and transported.
- Days already in a user's checkpoint keep the pre-fix `input`. The README's Known Limitations records that a fold-arithmetic change reaches new events only.

## Testing

`tests/usage-stats.spec.ts` pins the arithmetic at all four accumulators rather than the day total alone — a fix applied to only the day bucket would otherwise leave the filtered and hourly views disagreeing with it, and that mutation was confirmed to fail the spec. `tests/UsageSection.client.spec.tsx` renders a window with `searches: 2 + 3` and asserts the `5 次网络搜索` subline, plus a second case proving a zero count still renders; dropping the subline was confirmed to fail both.

`tsc -b tsconfig.client.json tsconfig.node.json` is clean and the package suite passes 81 tests.

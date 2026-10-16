# Agent Note: Usage stats clones days on first write and reports a load as loading

Status: implemented

English | [中文](2026-10-16-usage-stats-fold-clone-and-load-state.md)

## Problem

Two findings came out of an audit of the usage plugin.

**Every fold cloned the whole aggregate.** `foldAll` built its working state with `restoreDay(structuredClone(persistDay(day)))` for every committed day. `persistDay`/`restoreDay` exist to convert between the in-memory `Map` shapes and the JSON checkpoint shape, so routing a clone through them converted the same data twice and rebuilt all 24 hour objects per day on top of the copy `structuredClone` had already made. At the 370-day protocol ceiling that cost about 29 ms on every fold, whether or not anything changed.

**The metric cards read as a measured zero while loading.** `loading` is `!hasValue`, and the chart branch already renders a loading label when it is true. The four metric cards did not: they rendered `formatFull(totals.input)` over buckets that had been cleared, so a cold start — `value: null`, no checkpoint, backfill measured at 19–28 s on this machine — showed four cards reading `0` next to a chart saying 加载中. `0` is the same text the page uses for a measured empty window, so the two states were indistinguishable. Switching window, date, or model had the same effect.

## Decision

**Clone per day on first write.** The fold's `days` map now starts as a shallow copy of the committed map, and `day()` clones a day the first time this fold touches it. `day()` is the only writer of `state.days`, so the copy-on-write is complete by construction: a day this fold has not written is still the very object readers see through `committed`, and a fold that throws leaves the committed aggregate untouched. The shallow map copy is about 0.1 ms, so the common case — only sessions crossing a durability barrier are visited, and a fold that changes nothing touches no day — no longer pays a per-day cost at all. A touched day costs about 0.027 ms against 0.043 ms through the round trip.

**The cards show a dash before the first response.** While `loading`, each of the four cards renders `—` instead of a number, and the two sublines are suppressed because a hit rate over an unknown denominator is meaningless. This matches the chart's existing loading branch and leaves `0` meaning only "measured empty window". Switching window, date, or model still drops the previous buckets — the previous window's numbers are not the new window's — so the switch reads as loading rather than as a false total.

## Alternatives considered

**Prune days older than the `[1, 370]`-day window.** Rejected. A trailing window cannot reach them, but the date picker's `prevMonth` has no lower bound and the host deliberately answers any date, returning a zero bucket for an absent day rather than an error. Pruning would therefore turn a real past day into a silent reading of zero. At the measured 2.4 KiB per day the checkpoint reaches roughly 900 KiB at the ceiling, which is not yet worth that.

**Sparse hour buckets.** On the real checkpoint 89% of the 24 hour slots per day held no usage, and encoding only the non-empty ones would cut the hour payload by about 68%. Rejected for now: it changes the stored shape, so it needs a domain version bump, and a bump makes both backends reject the stale unit with `version-mismatch` at open — the JSON backend keeps the file rather than backing it up — which strands every plugin injecting `storageDomain` until the unit is cleared. Worth revisiting if the checkpoint ever becomes a real cost.

**Keep the previous window's buckets visible during a switch, like the refreshing path does.** Rejected. The refreshing path re-reads the *same* window, so its buckets are still the answer. A switch asks a different question, and showing the old window's totals under the new window's labels would be wrong in a way a loading placeholder is not.

**Render a skeleton or shimmer instead of a dash.** Rejected as more machinery for a state that lasts one request; the dash reuses the typography already present and needs no new styles.

**Eagerly clone but only when the fold will change something.** Rejected: whether a fold changes anything is known only after it runs, and the per-day clone gets the same result without the prediction.

## Consequences

- A no-change fold now costs one `Map` copy. A cold fold is unchanged in kind; the saving is proportional to how many days exist but not to how many are visited.
- The fold's working state shares day objects with the committed aggregate until written, so a reader that walks `committed` while a fold runs sees consistent per-day totals, as before.
- `persistDay`/`restoreDay` remain in use for the two places that genuinely convert shape: seeding from the checkpoint and writing it back.
- The page no longer shows `0` before the first response, and a window switch no longer blanks the cards into a false total.
- The README records the two deferred options — pruning and sparse hours — with the measured numbers and the reason each is deferred, so the next reader does not have to rediscover the version-bump cost.

## Testing

Removing the per-day clone makes `does not expose partial totals or advance cursors when checkpoint saving fails` fail, because the in-flight fold then mutates the committed day a cached read is serving. Removing the dash makes `shows a placeholder rather than a measured zero before the first response` fail. Making `setDays` retain the previous buckets makes `reports a window switch as loading rather than a measured zero` fail. Each was confirmed by mutation before the code was restored.

`tsc -b tsconfig.client.json tsconfig.node.json` is clean and the package suite passes 83 tests.

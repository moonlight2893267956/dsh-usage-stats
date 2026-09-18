# Agent Note: usage-stats checkpoint rides the profile's storage backend

Status: implemented

English | [中文](2026-09-18-usage-stats-checkpoint-backend.zh.md)

## Problem

[The predecessor note](2026-09-07-usage-stats-sqlite-checkpoint.md) persisted the `usage_stats` fold into a `storage-domain` checkpoint and routed that domain to `storage-sqlite` from the shipped Web composition. `storage-sqlite` opens its database in its constructor, and the Web profile is also the profile the browser-only Worker deployment composes: `apps/web/tests/preview-boot.e2e.ts` packs the Web profile into a VFS image, boots it, and asserts a clean console. That host stubs `node:sqlite` to fail, so the packed chain reported `web-preview: node:sqlite.DatabaseSync is not available in the worker host` and `dsh-webworker: warning: 1 entry did not activate / usage-stats`. The Web profile's other SQLite row, `session-query-sqlite`, is configured `openAt: never` for exactly this reason, so the eager backend was the only row that could not boot there.

## Decision

The shipped Web composition mounts `usage-stats` on base's storage defaults. The `usage_stats` checkpoint rides the `json` backend like every other domain, and the composition adds neither a `storage-sqlite` row nor a `storage-domain` `routes` override. A deployment that wants the SQLite medium adds both in its own later patch layer. The checkpoint's design is otherwise unchanged: one global record, seeding at `Service.init`, and write-back after a mutated fold.

## Alternatives considered

- **Keep the eager `storage-sqlite` row and disable it on the Worker host.** Rejected: nothing the loader context exposes distinguishes that host — the Worker's `node:sqlite` stub fails at module level rather than through a readable service — and `storage-domain` would keep routing `usage_stats` to a backend the same host never registers, so the failure would move from the backend row to the domain open.
- **Give `storage-sqlite` a lazy `openAt` option.** Rejected: deferred opening is `session-query-sqlite`'s search-specific lifecycle, and adding a matching field to the storage backend widens its published config for one deployment's benefit.
- **Drop the checkpoint and keep the in-memory accumulator.** Rejected: it re-pays the full cold backfill the checkpoint exists to avoid, and the checkpoint is what makes the Web page's repeat visits cheap.

## Consequences

- `apps/web/tests/preview-boot.e2e.ts` boots a clean chain again: no entry fails activation, and the Worker host never reaches the SQLite constructor.
- The `usage_stats` checkpoint writes through `storage-json` into `<dsh home>/storages`. Because the layout is one global record, each mutated fold rewrites that unit's whole document — totals plus the per-session fold progress map — where SQLite would have touched one row. The document stays small next to the log scan it replaces, so write volume is bounded by the number of folds rather than by session history.
- Durability is unchanged: the checkpoint still survives restarts and repeated visits, and it remains derived data whose loss costs one tail replay.
- A deployment that routes `usage_stats` to `sqlite` keeps the version-stamp behavior the predecessor note records, including the hard `version-mismatch` at open whose recovery is a unit clear. The `json` backend honors `invalidRecords: 'backup-and-skip'` instead, so the checkpoint's own record is backed up rather than failing the open.

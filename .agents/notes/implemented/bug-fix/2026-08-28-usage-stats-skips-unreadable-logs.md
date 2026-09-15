# Agent Note: Usage stats skips unreadable logs

Status: implemented

English | [中文](2026-08-28-usage-stats-skips-unreadable-logs.zh.md)

## Problem

The Web usage page folds token and search totals by scanning every materialized Session log through `SessionPersistence.readFrom`. A single historical JSONL artifact with committed-log corruption, such as a seq gap inside the stored prefix, made that Remote reject before any aggregate reached the client. The persistence backend is correct to fail loud for that artifact, but the usage view is a best-effort read model over many independent Sessions; one unreadable history item should not hide all other usage.

## Decision

`UsageStatsService.foldAll` catches `readFrom` failures per Session snapshot. It logs a warning naming the skipped Session id and leaves already folded totals intact, then continues folding the remaining readable snapshots. The skipped snapshot's revision is recorded as observed, so repeated usage-page refreshes do not repeatedly parse and warn for the same unreadable bytes. If the artifact is later repaired or appended, the stat-derived revision changes and the service retries the read.

The persistence service contract is unchanged: `readFrom` still rejects corrupt committed prefixes. The tolerance belongs to this aggregate Consumer because its output is a cross-Session summary rather than a resume, inspect, feedback, or recovery path that needs the exact target log.

## Testing

`packages/session/usage-stats/tests/usage-stats.spec.ts` stubs one snapshot whose `readFrom` rejects with the observed seq-gap error and another readable snapshot with usage and search events. The test requires the readable totals to be returned, one warning to be emitted, and the unchanged corrupt revision to be skipped on the next query.

## Alternatives considered

**Repair or truncate the corrupt JSONL from the usage fold.** Rejected because usage stats is not a persistence-recovery owner and cannot decide whether committed records may be discarded. Existing persistence repair remains limited to torn tails and balanced-log recovery.

**Let the Remote continue failing.** Rejected because it turns an unrelated historical artifact into a total outage for the usage page, even though the requested aggregate can still be partially correct for every readable Session.

**Mark the cursor advanced without recording the failed revision.** Rejected because the service has not folded any events from that snapshot, and retrying the same unreadable bytes on every refresh only repeats work and logs noise.

## Consequences

Usage totals become best-effort when historical storage contains an unreadable Session. The skipped Session's tokens and searches are absent until the artifact changes to a readable revision, while healthy Sessions continue to report normally. Operators still get a server warning with the Session id needed to inspect or repair the damaged artifact.

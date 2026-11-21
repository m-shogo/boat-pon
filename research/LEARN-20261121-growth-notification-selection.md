# LEARN-20261121-growth-notification-selection

Status: research-only, synthetic evidence; no production incidence measured.
Canonical source: main `daf465a5ca0a20578db49a2d2f733495d07d493e`, `scripts/report-growth.ts` (blob `70c239705d12d9448763657115b276786c7cfd35`).
Recorded: 2026-11-21.

## Observation and scope
The growth report selects `notification_log.sent_at` using a scalar correlated subquery filtered by `race_id`, `channel='line'`, `status='SENT'`, with **no ORDER BY** or aggregation. If multiple matching rows exist, the query does not specify which successful notification is selected. The subsequent `classifyBuyTiming` call uses that selected timestamp to compute the reported notified BUY count. This is a report/measurement ambiguity, **not evidence that any notification was late**.

An earlier isolated, synthetic SQLite reproduction used two successful notifications at 09:00 and 10:00 and an unsuccessful 08:00 row; the unordered scalar subquery selected 10:00 while `MIN(sent_at)` was 09:00. This does not establish deterministic selection across plans, engines or data. No private DB, raw odds, notification delivery, or production code was accessed for this record.

## Decision boundary
Do not change the notification service, production SQL, or reporting semantics without first identifying the documented intended event: first successful notification, latest successful notification, or a BUY-specific notification. A `race_id`-only predicate may also match notifications for other decisions on the same race; this requires schema/contract review. Never infer live affected counts from the synthetic fixture.

## Safe follow-up
Add a research-only synthetic fixture for multiple SENT rows, failed rows, cutoff-boundary timestamps and event identity; document the metric definition and then propose a separate read-only report fix with expected scorecard field impact. No Current BUY, LINE, public, N2, Owner Dashboard, automated betting, production settings or private paths.

## Learning gate
- fingerprintKey: `research.growth.notification-timestamp-selection`
- attemptSignature: `audit-unordered-scalar-notification-selection-and-record-boundary`
- environmentKey: `github-main-source-plus-prior-isolated-sqlite/no-production-db`
- materialStateKey: `main@daf465a5/pr2288-open/report-growth@70c23970`
- outcome: `VERIFIED_SUCCESS` (source-level ambiguity and synthetic reproduction only)
- reuse rule: do not repeat the same reproduction without a new contract, fixture, or material source change.

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

## 2026-11-21 schema-contract correction (append-only)

Latest canonical `main` `server/db.ts` defines `CREATE UNIQUE INDEX IF NOT EXISTS notification_log_race_channel_uq ON notification_log (race_id, channel)`. `scripts/lib/notificationLog.ts` uses `ON CONFLICT(race_id, channel)` and refuses to reset `SENT`/`SENDING` rows. Consequently, the earlier synthetic fixture with multiple `SENT` rows for the *same race and line channel* violates the canonical schema and is **not a reachable normal-state reproduction**. The unordered scalar subquery is syntactically under-specified, but with the declared unique index intact it can return at most one row. Do not infer a live timestamp-selection defect, notification lateness, or affected counts from that fixture. The fixture remains a hypothetical robustness test only; the real SQLite database schema and legacy migrations were not inspected. The one-row-per-race/channel design also does not independently establish that the row is a BUY-specific event; determine that from the notification producer and scorecard contract before changing metrics.

- fingerprintKey: `research.growth.notification-timestamp-selection`
- attemptSignature: `verify-main-schema-unique-index-and-upsert-contract`
- environmentKey: `github-main-source-read-only/no-production-db`
- materialStateKey: `main@daf465a5/pr2288-open/server-db-unique-race-channel`
- outcome: `REUSED_LEARNING` with material correction to applicability; no production incident confirmed
- next safe action: audit producer/event semantics and schema migrations read-only; do not alter Current BUY, LINE or production report logic.

## 2026-11-21 producer-versus-report identity audit (append-only)

Canonical main source comparison (read-only): `scripts/notify-line.ts` applies `n.title LIKE '% ' || dh.selection || '%'` when determining whether a BUY was notified for the daily summary and result messaging. By contrast, `scripts/report-growth.ts` and `scripts/report-accuracy-scorecard.ts` select `SENT` by race/channel without the selection/title predicate. The canonical `(race_id, channel)` uniqueness rule prevents duplicate same-channel rows, but does **not** prove that the sole SENT row represents the BUY selection under measurement. This is a **cross-report event-identity contract discrepancy**, not proof of live miscount. No real DB, affected count, or private data was accessed. Do not change production reporting or notification behavior until the intended identity semantics are verified with a schema-valid synthetic fixture and the scorecard metric impact is bounded.

- fingerprintKey: `research.growth.notification-event-identity`
- attemptSignature: `compare-growth-scorecard-and-notify-line-buy-selection-predicates`
- environmentKey: `github-main-source-read-only/no-production-db`
- materialStateKey: `main@daf465a5/pr2288-open/unique-race-channel/report-predicate-difference`
- outcome: `REUSED_LEARNING` (new source-level distinction; no production incident verified)
- next safe action: construct one-row-per-race/channel synthetic notification scenarios for mismatched BUY selection and check expected classifications in isolated research tests.

## 2026-11-21 schema-valid identity boundary reproduction (append-only)

An isolated Python sqlite3 in-memory test created notification_log with the canonical UNIQUE(race_id, channel) constraint, then inserted exactly one SENT LINE row for race r1 with title "RESULT 1-2-3" and sent_at 09:00. The report's race/channel/status-only scalar lookup returned 09:00, whereas the producer-style predicate additionally requiring title LIKE '% ' || '2-3-4' || '%' returned NULL for the BUY selection 2-3-4. A second LINE row for r1 was rejected by the unique index. This confirms a **reachable schema shape in synthetic data** in which the predicates disagree, not that such an event was emitted by the actual producer or occurred in production. No production database, notification send, private odds, or production code was accessed. The synthetic test used an isolated minimal schema, not the repository's full migration path.

- fingerprintKey: `research.growth.notification-event-identity`
- attemptSignature: `schema-valid-single-line-row-mismatched-title-sqlite-reproduction`
- environmentKey: `python-sqlite3-in-memory/synthetic/no-production-db`
- materialStateKey: `main@daf465a5/pr2288-open/unique-race-channel/single-sent-row-title-mismatch`
- outcome: `VERIFIED_SUCCESS` (synthetic SQL predicate difference only)
- next safe action: inspect the producer's creation and transition semantics for non-BUY same-race events, then consider a research-only executable fixture tied to canonical SQL. Do not modify notification, BUY, scorecard, or production paths.


## 2026-11-22 producer-key and sent-state narrowing (append-only)

Read-only inspection of canonical main `be25facc5a4393344c25caf4759af07acb8e9a0d`: `scripts/notify-line.ts` checks for an existing `notification_log` row with the exact `race_id` and `channel='line'`, and declines to recreate it when status is `SENT` or `SENDING`. `scripts/lib/notificationLog.ts` independently guards its UPSERT with `status NOT IN ('SENT','SENDING')`. Result and summary notifications shown in the same source use distinct prefixed keys (for example `line-buy-result-fast-`, `line-buy-result-`, `line-weekly-growth-`) rather than the bare race identifier. Therefore those prefixed events **cannot** by themselves supply the bare-race `SENT` row selected by `report-growth.ts`; the previous synthetic `RESULT` title under a bare race ID demonstrates predicate behavior but does **not** demonstrate that the actual producer emits that state. The remaining question is whether the bare-race key can be sent with a nonmatching BUY title through any current producer or historical transition. No real database or private data was inspected. No live miscount or readiness quantity is established.

- fingerprintKey: `research.growth.notification-event-identity`
- attemptSignature: `trace-producer-key-prefixes-and-sent-upsert-guard`
- environmentKey: `github-main-source-read-only/no-production-db`
- materialStateKey: `main@be25facc/pr2288@630f37cf/unique-race-channel/prefixed-results`
- outcome: `REUSED_LEARNING` (narrowed reachability; no new production failure established)
- next safe action: inspect the bare-race notification creation call site and its title construction, then assess whether any mismatched selection is reachable before changing research metrics.

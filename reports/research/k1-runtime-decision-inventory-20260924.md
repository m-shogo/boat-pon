# K1 Runtime Decision Persistence Inventory — 2026-09-24

Status: research-only inventory; no production authority  
Authority base: `d2a7db1802193fd90eb4a6ce38f5cc80167795eb`  
Contract: `docs/architecture/research-knowledge-retention-contract.md` §3 K1 and §8 step 1

## Scope

Inventory the existing decision, notification, settlement, and report persistence against the K1 minimum retained context. This report does not change Current BUY, LINE, app settings, notification delivery, betting behavior, or production data.

Evidence inspected:

- `server/db.ts` schema and read/write paths for `decision_history`, `notification_log`, `race_results`, `odds_snapshots`, and `odds_timeseries_snapshots`.
- `docs/audit-persistence-implementation.md` for the existing decision-reason / feature-adjustment persistence contract.

No private database rows, raw T-5 odds, secrets, or private filesystem paths were inspected or retained.

## K1 requirement matrix

| K1 requirement | Existing durable field/path | Status | Gap / implication for Runtime Decision Ledger |
| --- | --- | --- | --- |
| race identity | `decision_history.race_id`, `date`, `venue`, `race_no`, `selection` | present | Canonical ledger identity still needs an explicit immutable decision/run identity; current row `id` is storage-local. |
| decision identity | `decision_history.id`, race/selection lookup | partial | No explicit stable decision ID/versioned ledger identity is persisted. Existing `insertDecisionHistory()` can update an existing row, so it is not an immutable event ledger. |
| decision system | `run_kind` | partial | Separates live/shadow/backfill semantics, but is not a complete decision-system identifier. |
| strategy/model/feature version | `model_version`, `feature_adjustment`, `feature_adjustment_breakdown` | partial | Model version exists; no explicit strategy version or feature-schema/version identifier is persisted. |
| decision timestamp | `created_at` | partial | `created_at` is insertion time and an UPDATE preserves the original value; no explicit `decided_at` for each evaluation/update. |
| odds snapshot timestamp | `fetched_at`; odds tables have `captured_at` | partial | Decision row does not persist the exact odds snapshot ID or `captured_at` used by that decision. Joining by race/selection later can be ambiguous. |
| candidate | selection, estimated/raw/conservative hit rate, required/current odds, EV, recommended stake, sample size, race category | present/partial | Core candidate is retained, but exact input evidence identity is not frozen on the decision row. |
| decision | `decision` | present | BUY/WATCH/SKIP-style result is durable. No production authority inferred. |
| reason / block reason | `decision_reasons` | partial | Reasons are durable; block reason is not a separately typed field, so machine reconciliation depends on prose/reason conventions. |
| feature adjustment / breakdown | `feature_adjustment`, `feature_adjustment_breakdown` | present | Existing audit-persistence contract covers these fields. |
| data completeness / freshness | source, `fetched_at`; some upstream source-quality fields exist outside `decision_history` | partial | No frozen completeness/freshness summary or input snapshot manifest is persisted per decision. |
| notification eligibility | decision status is checked before `createNotificationIfNeeded()` | derived only | Eligibility is not persisted as immutable decision-time state. |
| delivery identity | `notification_log.id`, `(race_id, channel)` unique key, status/sent_at | partial | Notification is keyed by race/channel, not explicit decision ID; cannot prove which decision revision generated a delivery when a decision row is updated. |
| later settlement linkage | `decision_history.result`, `payout_yen`, `popularity`, `returned`; `race_results.race_id` | partial | Result is copied by race, but no immutable settlement/outcome identity or reconciliation status links a specific decision event to a final outcome. |
| refund / invalidation semantics | `returned` | partial | Return flag exists; a future Outcome Learning Ledger still needs explicit finality/invalidation semantics and reconciliation identity. |

## Concrete finding

The existing `decision_history` is a useful operational audit table, but it is **mutable state**, not yet the canonical Runtime Decision Ledger described by K3. `insertDecisionHistory()` locates an existing race/selection row and updates it in place; with `replaceRace`, it may also reuse one race row and delete sibling rows. That behavior is valid for the current operational table but cannot serve as immutable research-ledger semantics without a separate read-only projection/backfill design.

The highest-value missing boundary is therefore **identity and evidence binding**, not another copy of existing decision fields:

1. stable immutable `decisionId` / evaluation identity;
2. explicit `decidedAt` per evaluation;
3. decision-system + strategy/model/feature version tuple;
4. exact decision-time odds/evidence snapshot identity and timestamp;
5. explicit completeness/freshness snapshot;
6. explicit notification eligibility/delivery linkage by decision identity;
7. explicit settlement/outcome reconciliation identity and finality.

## Safe next implementation step

Proceed to §8 step 2: define the canonical Runtime Decision Ledger contract and a **read-only** backfill/reconciliation plan from current operational tables. The first implementation must not mutate `decision_history`, `notification_log`, Current BUY, LINE, or `app_settings`; it should define deterministic identity, immutable event semantics, source-field mapping, missingness, and conflict handling before any ledger writer exists.

Fail closed where historical rows cannot establish exact odds snapshot identity or exact decision time: record those fields as unavailable/ambiguous rather than reconstructing them from later data.

## Learning-gate normalization

This inventory attempt is normalized as:

- `fingerprintKey`: `research-k3.k1-runtime-decision-inventory`
- `attemptSignature`: `static-schema-and-read-write-path-inventory-v1`
- `environmentKey`: `github-canonical-main-readonly`
- `materialStateKey`: `decision-history-schema-and-persistence@d2a7db18`

No matching prior Learning Fingerprint was found for this K1 inventory target. Gate action: `PROCEED`.

## Classification

`NO_NEW_LEARNING` for the Learning Fingerprint registry: this is a planned K1/K3 inventory finding, not a new failure class or non-obvious reusable execution guardrail. The durable research output is this governance/evidence inventory itself; no filler `LEARN-*` record is warranted.

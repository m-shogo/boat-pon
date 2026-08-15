# BUY Outcome Learning Loop

Status: read-only outcome-learning loop

## Purpose

Turn settled Current BUY outcomes into durable, reviewable knowledge without allowing a single outcome, dashboard metric, or scheduled task to mutate Current BUY, LINE, `app_settings`, selectors, model parameters, or production behavior.

## Flow

```text
decision_history + settled result
  -> read-only aggregate report
  -> strict public-safe BUY learning summary
  -> Owner Dashboard
  -> proposed improvement research

same aggregate semantics
  -> semantic digest
  -> private append-only learning snapshot
  -> later research comparison / novelty review
```

The dashboard is a read model only. The private retained snapshot is learning memory, not production authority.

## Authorities

- Decision/outcome facts: existing local `decision_history` and settlement/result evidence.
- Automatic Current BUY scope: `run_kind=paper-live`. Historical backfills, samples and manual tests are not mixed into the owner learning refresh.
- Settlement economics: official `decision_history.payout_yen`, expressed as yen returned per 100 yen. A row is economically settled only when result and payout are both present and it is not returned/refunded.
- Research/governance truth: existing `research/registries/` and N2 governance contracts.
- Private learning retention: `data/private/outcome-learning-ledger/`, ignored by Git, mode-restricted, digest-addressed and append-only.
- Public projection: `buy-learning-public-summary-v1` nested inside `owner-dashboard-read-model-v2`.

No new BUY authority is created.

## Diagnostics

The read-only report derives only aggregate evidence:

- total / economically settled BUY count;
- hits / misses and hit rate;
- realized unit-stake ROI proxy and max-hit-excluded proxy from official payout;
- recent settled-window hit rate / realized ROI proxy;
- small-sample misses;
- high-estimated-probability misses;
- high-EV misses.

`current_odds` remains valid as a **decision-time segmentation/input fact** (for example the odds-band axis), but it is not used as realized payout economics.

These thresholds are diagnostic triggers, not strategy rules. They may create `PROPOSED` research candidates only. Every candidate carries `productionChangeAllowed=false`.

## Learning retention

A semantic digest excludes generation time. Identical learning state therefore reuses the same digest-addressed private record instead of producing hourly duplicates. A changed aggregate/learning state creates a new immutable record. Existing conflicting content at the same digest fails closed.

The retained record must not be committed, uploaded as a GitHub artifact, or copied into the Cloudflare public bundle.

## Public privacy boundary

The public summary intentionally excludes:

- race / decision identities;
- exact selections;
- raw odds observations or T-5 payloads;
- required odds / recommended amounts / stakes;
- local paths and DB names;
- notification identity;
- private readiness / holdout keys;
- raw decision reasons or evidence rows.

Nested fields are strict-allowlisted. Unknown fields or forbidden markers are rejected before public deployment.

## Refresh behavior

`owner-buy-learning-refresh.yml` runs on the Mac-local runner after successful main CI and after a successful one-shot local research run. It:

1. reads the local DB using `readOnly: true` plus `PRAGMA query_only = ON`;
2. selects settled `paper-live` BUY outcomes only;
3. uses official settlement payout for outcome economics while keeping decision-time odds only as an analysis axis;
4. derives and privately retains the semantic BUY learning state;
5. builds the Owner snapshot with the safe summary;
6. verifies public source boundaries and the final deploy artifact;
7. rejects private/secret markers;
8. deploys the enriched static dashboard to Cloudflare.

The older Ubuntu workflow remains static validation only so a snapshot with unavailable private learning cannot overwrite an enriched dashboard.

## Improvement / promotion boundary

The loop may identify a research question, retain a failure pattern, or prioritize a read-only evaluation. It must not:

- activate dormant N2 tasks;
- consume N2 attempts;
- modify the research queue;
- change Current BUY / WATCH / SKIP rules;
- alter LINE behavior;
- train or promote a model automatically;
- create automated betting behavior.

Any future behavior adaptation still follows the repository's existing Experiment -> reproducible evaluation -> Discovery/Rejection -> Transfer -> human-approved promotion -> production gate path.

## Interpretation warning

The ROI remains a **unit-stake proxy**, not a cash-ledger P&L, because it normalizes official payout to a 100-yen stake and does not use actual stake sizing. It is now settlement-reconciled rather than decision-odds-based. Stronger cash claims still require a formal ledger binding actual stake, refunds/invalidations, frozen cohorts, model identity and point-in-time provenance.

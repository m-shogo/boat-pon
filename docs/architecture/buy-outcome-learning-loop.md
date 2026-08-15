# BUY Outcome Learning Loop

Status: implementation note for the read-only outcome-learning pilot

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
- Research/governance truth: existing `research/registries/` and N2 governance contracts.
- Private learning retention: `data/private/outcome-learning-ledger/`, ignored by Git, mode-restricted, digest-addressed and append-only.
- Public projection: `buy-learning-public-summary-v1` nested inside `owner-dashboard-read-model-v2`.

No new BUY authority is created.

## v1 diagnostics

The read-only report derives only aggregate evidence:

- total / settled BUY count;
- hits / misses and hit rate;
- decision-time odds ROI proxy and max-hit-excluded proxy;
- recent settled-window hit rate / ROI proxy;
- small-sample misses;
- high-estimated-probability misses;
- high-EV misses.

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
2. derives and privately retains the semantic BUY learning state;
3. builds the Owner snapshot with the safe summary;
4. verifies public source boundaries and the final deploy artifact;
5. rejects private/secret markers;
6. deploys the enriched static dashboard to Cloudflare.

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

The v1 ROI shown here is the repository's existing decision-outcome proxy based on decision-time `current_odds` for settled hits, matching the existing `report-decision-outcomes` semantics. It is useful for consistent monitoring but must not be mislabeled as a fully reconciled cash ledger. A future formal Outcome Learning Ledger should bind actual settlement economics, refunds/invalidations, frozen cohorts, model identity and point-in-time provenance before stronger claims are made.

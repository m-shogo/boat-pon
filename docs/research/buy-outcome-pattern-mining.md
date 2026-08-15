# BUY Outcome Pattern Mining

Status: read-only outcome-learning automation

## Separation from N2

This loop is not an N2 task family and does not activate, consume attempts from, or mutate the N2 queue.

- N2: long-horizon model/feature/research-platform work under existing N2 governance.
- BUY Outcome Learning: operational learning from already-issued BUY decisions after outcomes settle.

A BUY outcome pattern may create a **PROPOSED research candidate**, but it never becomes an N2 task automatically and never changes Current BUY. If a hypothesis later needs N2-grade model work, it must enter the existing governed research process explicitly.

## Automatic timing and scope

`owner BUY learning refresh` runs after a successful main CI and after a successful `boat-pon local research (one-shot)` run. Because the existing ChatGPT scheduler dispatches the one-shot research loop, outcome learning is refreshed automatically alongside the hourly research cadence without introducing another repository schedule.

The automatic owner refresh is explicitly scoped to `run_kind=paper-live`. Historical backfills, manual tests and sample rows stay outside the Current BUY learning cohort.

Each refresh:

1. opens `decision_history` read-only (`readOnly: true`, `PRAGMA query_only = ON`);
2. requires result + official payout settlement and excludes returned/refunded rows;
3. mines repeatable success/failure segments using official payout economics normalized to a 100-yen unit stake;
4. stores exact segment evidence only in ignored `data/private/outcome-pattern-ledger/`;
5. exports a sanitized public signal with the exact segment identity removed;
6. merges sanitized signals into `WHAT WE LEARNED` and `IMPROVEMENT RESEARCH`;
7. retains the resulting semantic learning state privately with SHA-256 deduplication;
8. verifies the public artifact and deploys the enriched Owner Dashboard.

## Pattern policy

v1 considers these dimensions independently:

- venue;
- model version;
- estimated-hit-rate band;
- EV band;
- decision-time odds band;
- sample-size band.

A segment is not surfaced unless it has at least 30 economically settled BUY outcomes and its realized unit-stake ROI proxy differs from the all-BUY baseline by at least 0.15. These are discovery thresholds, not promotion thresholds.

`current_odds` remains an allowed decision-time segmentation axis. It is **not** used as the realized payout for ROI comparison.

Signals are classified as:

- `SUCCESS_EDGE`: segment realized ROI proxy is materially above the baseline;
- `FAILURE_REGIME`: segment realized ROI proxy is materially below the baseline.

`STRONG` means at least 100 settled observations and an absolute ROI-proxy delta of at least 0.25. Even `STRONG` remains exploratory because many segments are inspected.

## Multiple-comparison / overfitting boundary

Pattern mining searches many possible slices, so false discoveries are expected. Therefore:

- a mined pattern is a hypothesis, not a rule;
- production changes are always `productionChangeAllowed=false`;
- exact segment identity stays private;
- promotion requires the existing backtest / PIT / common-cohort / holdout / forward / governance path as appropriate;
- a single race or single high payout never creates a pattern;
- max-hit dependence remains separately monitored by the Outcome Learning summary.

## Learning retention

Exact patterns are stored in a digest-addressed private ledger. Re-running with identical semantic evidence does not create another record. New evidence that changes the mined pattern state produces a new immutable record.

This allows later analysis of:

- which failure regimes disappeared after an improvement;
- whether an apparent success edge survived more data;
- whether an improvement increased hit rate but damaged ROI or BUY frequency;
- whether a model version introduced a new failure regime.

## Public Dashboard boundary

The public Owner Dashboard receives only:

- pattern direction;
- dimension class;
- evidence count;
- baseline realized ROI-proxy delta;
- WATCH/STRONG classification.

It does **not** receive the exact venue, model version, odds band, confidence band, race identity, selection, raw odds, stake, or private evidence rows.

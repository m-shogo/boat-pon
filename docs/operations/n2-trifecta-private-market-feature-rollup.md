# N2 Private Trifecta Market Feature Rollup

## Purpose

The private checkpoint collector already captures bounded market observations automatically. The derived market-feature artifacts and day index should be able to catch up without a manual one-off operation after every new accepted checkpoint.

This rollup provides that derived-only maintenance loop. It reads the already-private capture evidence for the current validated one-venue plan, refreshes eligible private feature artifacts, and refreshes the private day index when the complete rollup is clean.

It does **not** fetch BOAT RACE pages, change the checkpoint collector, create experiment manifests, materialize exploration matrices, read outcomes, evaluate ROI, or connect anything to Current BUY.

## Scope authority

The rollup does not accept an arbitrary venue argument. Its only scope authority is the validated current-JST-day private plan:

```text
data/private/trifecta-capture/plans/YYYY-MM-DD.json
```

The plan must pass the existing private daily-plan cache validator and must resolve to exactly:

```text
one venue
races 1 through 12
48 checkpoint entries
```

A missing plan is a quiet `NO_CHANGE`. A malformed, tampered, stale or otherwise invalid existing plan is `BLOCKED`.

## Per-race behavior

For races 1 through 12 the rollup calls the existing private feature loader.

- `PASS`: create or refresh the private v2 feature artifact.
- `PARTIAL`: create or refresh the private v2 feature artifact with explicit missing checkpoints.
- `NO_DATA`: create no feature artifact.
- `BLOCKED`: preserve the blocker and fail the aggregate rollup closed.

Feature artifacts remain under:

```text
data/private/trifecta-market-features/<date>/<venue>/<race>.json
```

They retain the existing atomic mode-0600 derived-artifact contract. Raw HTML, envelopes and accepted markers remain immutable source evidence.

A feature artifact may be safely refreshed before a later race in the same run is found to be blocked. However, if **any** race is blocked or a feature write fails, the rollup does not refresh the day index. This prevents a new aggregate index from representing a run that did not validate cleanly end-to-end.

## Day-index refresh

When all 12 race scans complete without blockers, the rollup rebuilds and writes the verified private day index:

```text
data/private/trifecta-market-features/<date>/<venue>/index.json
```

Status semantics:

- `PASS`: all 12 races have complete T-30/T-20/T-10/T-5 feature trajectories.
- `PARTIAL`: at least one PASS/PARTIAL race exists, with no blocked race.
- `NO_DATA`: all 12 races have no accepted checkpoint evidence yet.
- `NO_CHANGE`: the current-day private plan is not available.
- `BLOCKED`: plan validation, feature loading/writing, or day-index refresh fails closed.

## Scheduling

The persistent GitHub Actions workflow is:

```text
N2 Private Market Feature Rollup
```

It runs on the self-hosted Mac at minute 23 from 08:23 through 23:23 JST and also supports manual `workflow_dispatch`.

Derived feature maintenance is intentionally **not exact-time work**. If the Mac is asleep, the self-hosted runner is busy, or a scheduled job is delayed, the next hourly run can safely catch up from already-accepted private evidence. This is fundamentally different from checkpoint capture, where a missed market window cannot be reconstructed later.

The checkpoint collector remains a local launchd process and does not depend on this Actions workflow.

## Network boundary

The rollup process itself performs:

```text
market/source network requests: 0
database reads: 0
database writes: 0
```

It may read private raw capture evidence locally through the existing feature loader because feature derivation must verify the accepted source evidence. Raw odds values are never printed or published.

The GitHub Actions job runs `npm ci`, so package installation may use the npm registry. Therefore the correct guarantee is **no BOAT RACE / market-source network request from the rollup**, not that the entire workflow has zero Internet traffic.

## Protected boundaries

Every rollup report fixes:

```text
privateResearchOnly: true
rawOddsValuesPrinted: false
rawOddsValuesPublished: false
networkRequestCount: 0
databaseReadCount: 0
databaseWriteCount: 0
currentBuyChanged: false
lineChanged: false
publicPublished: false
automatedBettingChanged: false
productionApplyExecuted: false
```

The rollup does not modify:

- Current BUY;
- selector/model parameters;
- decision history;
- LINE;
- primary or sidecar DB rows/schema;
- public/Cloudflare assets;
- automated betting;
- checkpoint authorization, timing, request budgets or immutable collector runtime authority.

## What is intentionally not automated

This workflow does **not** automatically freeze or replace:

- private experiment-input manifests;
- exploration matrices;
- registered hypotheses/protocols;
- validation or holdout cohorts;
- outcome/payout/ROI joins;
- model training;
- production promotion.

Those boundaries remain explicit and governed. A mutable current-day derived index is useful for accumulating knowledge; an experiment cohort must still be frozen deliberately by digest before analysis.

## Manual execution

The current-JST-day rollup can be run locally with:

```bash
npx tsx scripts/run-n2-trifecta-private-market-feature-rollup.ts
```

For deterministic tests/review:

```bash
npx tsx scripts/run-n2-trifecta-private-market-feature-rollup.ts \
  --now 2026-08-07T03:00:00.000Z
```

Stdout is sanitized race/checkpoint coverage and lineage metadata only. It does not contain raw odds, selection arrays, transition move arrays or full feature vectors.

## Safe failure and recovery

The rollup prefers missing derived output over corrupt aggregate state.

- Missing current-day plan: quiet `NO_CHANGE`; next run tries again.
- Invalid plan: `BLOCKED`; no feature processing.
- Individual race blocker: aggregate `BLOCKED`; no day-index refresh.
- Feature write failure: aggregate `BLOCKED`; no day-index refresh.
- Day-index refresh failure: aggregate `BLOCKED`.
- Host/runner delay: no special backfill logic; next hourly run re-derives from the accepted private evidence that already exists.

Because the underlying feature artifacts are source-digest-aware and the day index is derived, repeated successful rollups are idempotent when no checkpoint evidence has changed.

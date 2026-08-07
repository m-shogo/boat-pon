# N2 Trifecta Private Market Daily Readiness

Status: private research operability contract  
Scope: derived market-evidence readiness only  
Production authority: none

## Purpose

The daily readiness artifact answers one narrow question:

> How much verified private trifecta market trajectory evidence exists for the current one-venue research day, and was the local capture heartbeat operable enough to interpret that coverage?

It does **not** answer whether a strategy is profitable, whether a race should be bought, or whether an experiment should be promoted.

## Inputs

The builder uses only local private derived/operability authorities:

1. `data/private/trifecta-market-features/YYYY-MM-DD/VV/index.json`
2. private heartbeat history for the same JST date
3. the validated private daily plan indirectly through heartbeat-gap diagnostics

The stored day index is not trusted by filename alone. The builder:

- requires a regular mode `0600` file;
- validates version, date, venue and digest shape;
- rebuilds the day index from verified v2 private feature artifacts using the stored `generatedAt`;
- requires the rebuilt digest to equal the stored index digest.

Heartbeat diagnostics independently validate their private history and current daily-plan boundary.

## Output

A readiness artifact contains metadata only:

- source day-index digest and status;
- complete / partial / no-data race counts;
- identities of complete races that could later be explicitly selected into an exploration manifest;
- total snapshot and transition counts;
- checkpoint coverage numerator over the fixed denominator `48`;
- heartbeat status, history count, significant-gap counts, affected checkpoint count and current-gap state;
- protected-boundary flags;
- canonical output digest.

It does not contain:

- 120-selection odds vectors;
- selection-level moves;
- payout or settlement labels;
- ROI or hit rate;
- validation or untouched-holdout results;
- BUY/WATCH/SKIP decisions.

## Readiness status

`PASS`
: The day index is complete (`12 PASS` races), heartbeat diagnostics are `PASS`, and the heartbeat daily-plan context is available.

`DEGRADED`
: Evidence exists, but the day is incomplete and/or heartbeat operability is degraded or lacks validated plan context. This is a quality state, not an error and not a negative strategy result.

`NO_DATA`
: The verified day index contains no captured market trajectories.

`BLOCKED`
: Required evidence is invalid or heartbeat diagnostics fail closed.

## Non-promotion boundary

Every artifact fixes:

- `evidenceRole = EXPLORATION_READINESS_ONLY`
- `automaticFreezeAuthorized = false`
- `outcomeDataRead = false`
- `validationDataRead = false`
- `holdoutDataRead = false`
- `currentBuyConnectionAuthorized = false`
- `lineConnectionAuthorized = false`
- `automatedBettingAuthorized = false`
- `publicPublishAuthorized = false`
- `productionApplyAuthorized = false`

A readiness `PASS` is therefore **not** approval to freeze a cohort automatically. Cohort freezing remains an explicit experiment-input-manifest action, and promotion remains under the existing research-governance path.

## Storage

With `--write-private`, artifacts are written as immutable digest-addressed mode `0600` JSON:

```text
data/private/trifecta-market-experiments/readiness/
  YYYY-MM-DD/
    VV/
      <outputDigest>.json
```

The same digest is idempotently reused. A same-path content mismatch fails closed as a digest collision.

No readiness artifact is committed to Git.

## Schedule

The persistent workflow runs once at **23:45 JST** on the self-hosted Mac, after the hourly private feature rollup window.

The scheduled job:

- reads only local private evidence;
- writes only the digest-addressed private readiness artifact;
- performs zero market-source network requests;
- performs zero database reads/writes;
- does not freeze manifests or materialize outcome labels;
- does not change Current BUY, LINE, public projection, automated betting or production.

A workflow delay changes only when the readiness metadata is recorded. It is not in the capture critical path.

## Manual usage

Current JST day and venue from the validated private daily plan:

```bash
BOAT_PON_DATA_ROOT=/path/to/boat-pon \
  node node_modules/tsx/dist/cli.mjs \
  scripts/build-n2-trifecta-private-market-daily-readiness.ts
```

Persist privately:

```bash
BOAT_PON_DATA_ROOT=/path/to/boat-pon \
  node node_modules/tsx/dist/cli.mjs \
  scripts/build-n2-trifecta-private-market-daily-readiness.ts \
  --write-private
```

Historical/manual scope may be provided explicitly with `--date YYYY-MM-DD --venue VV --checked-at <ISO>`.

## Interpretation

The artifact is a durable K3/K4 bridge: it tells future research tooling what evidence coverage and operability existed, without introducing labels or claiming predictive edge.

The safe progression remains:

```text
private capture
-> verified feature artifacts
-> verified day index
-> daily readiness metadata
-> explicit exploration manifest
-> private exploration matrix
-> separately registered experiment/evaluation
```

There is intentionally no direct edge from readiness to Current BUY.

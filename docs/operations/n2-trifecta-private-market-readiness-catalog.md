# N2 Trifecta Private Market Readiness Catalog

Status: private research metadata contract  
Scope: discovery of verified daily-readiness artifacts  
Production authority: none

## Purpose

The readiness catalog makes multi-day private market evidence discoverable without scanning or interpreting raw odds.

It answers:

- which date/venue scopes have readiness evidence;
- which readiness artifact is the latest verified snapshot for each scope;
- how many source readiness snapshots exist for the scope;
- how complete the 48-checkpoint market trajectory was;
- whether the latest heartbeat/readiness state was healthy enough to interpret that coverage.

It does **not** choose an experiment cohort automatically and does not evaluate predictive performance.

## Source authority

The catalog scans only:

```text
data/private/trifecta-market-experiments/readiness/
  YYYY-MM-DD/
    VV/
      <readinessDigest>.json
```

Every source file must:

1. be a regular non-symlink mode `0600` file;
2. have a digest filename matching `outputDigest`;
3. reproduce its own canonical `outputDigest`;
4. match the date/venue encoded by its path;
5. satisfy 12-race and 48-checkpoint accounting invariants;
6. preserve the readiness protected-boundary flags.

Any malformed, permission-widened, path-mismatched or digest-mismatched source fails the catalog build closed.

## Latest-by-scope rule

All verified readiness snapshots remain immutable private evidence.

For catalog navigation, snapshots are grouped by `date + venueCode`. The entry selects the greatest `checkedAt`; digest is a deterministic tie-breaker.

The catalog records `scopeArtifactCount`, so choosing a latest snapshot does not pretend older snapshots never existed.

This is a navigation rule, not evidence deletion or supersession.

## Catalog entry

Each latest scope entry contains only metadata:

- date / venue;
- latest checked time;
- readiness digest and status;
- source day-index digest/status;
- complete / partial / no-data race counts;
- complete-race candidate count;
- checkpoint coverage numerator / 48 / ratio;
- heartbeat status and gap counts;
- number of readiness snapshots observed for that scope.

It contains no selection-level odds, moves, payouts, ROI, outcomes, validation results or holdout results.

## Storage and idempotency

The private catalog is stored at:

```text
data/private/trifecta-market-experiments/readiness/catalog.json
```

It is mode `0600` and atomically replaced when semantic content changes.

`generatedAt` alone is not new research evidence. If all verified source artifacts and latest-by-scope entries are unchanged, a later rebuild reuses the existing catalog file and digest rather than creating timestamp-only churn.

An invalid existing catalog is rebuildable from verified readiness artifacts; it is never trusted merely because the file exists.

## Schedule integration

The catalog is updated in the same **23:45 JST** self-hosted job immediately after the daily readiness artifact is written and validated.

The job verifies that the newly written readiness digest is the catalog's latest entry for that same date/venue before succeeding.

This avoids a separate cron race where readiness could advance but the catalog still point at the previous snapshot.

## Safety boundary

Every catalog fixes:

- `evidenceRole = EXPLORATION_READINESS_CATALOG_ONLY`
- `automaticFreezeAuthorized = false`
- `outcomeDataRead = false`
- `validationDataRead = false`
- `holdoutDataRead = false`
- `rawCaptureEvidenceRead = false`
- `rawOddsValuesRead = false`
- `networkRequestCount = 0`
- `databaseReadCount = 0`
- `databaseWriteCount = 0`
- `currentBuyConnectionAuthorized = false`
- `lineConnectionAuthorized = false`
- `automatedBettingAuthorized = false`
- `publicPublishAuthorized = false`
- `productionApplyAuthorized = false`

The catalog cannot freeze a manifest, label a race, promote a discovery, or affect Current BUY.

## Research progression

The intended path is:

```text
private capture
-> feature artifact
-> day index
-> daily readiness
-> readiness catalog
-> explicit human/research selection of source days
-> exploration input manifest
-> exploration matrix
-> registered experiment/evaluation
```

The arrow from catalog to manifest is deliberately **explicit**, not automatic.

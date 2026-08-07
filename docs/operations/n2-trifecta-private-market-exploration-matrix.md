# N2 Private Trifecta Market Exploration Matrix

## Purpose

The exploration-input manifest freezes *which* complete races belong to an exploration cohort. This materialization step resolves those manifest references into one deterministic private race-level numeric matrix without reading outcomes, validation data, holdout data, databases or network sources.

This is still an **exploration input**, not predictive evidence. A matrix with five races is useful for validating lineage/schema/materialization only; it is not enough to claim hit-rate, ROI or transferable edge.

## Fixed evidence boundary

Version v1 is fixed to:

```text
evidenceRole: EXPLORATION_ONLY
labelPolicy: NO_OUTCOME_LABELS
coveragePolicy: FULL_TRAJECTORY_ONLY
```

The builder requires an immutable private experiment-input manifest and then reads only the private feature artifacts referenced by that manifest.

It does not read:

- raw BOAT RACE HTML;
- capture envelopes or accepted-marker files;
- outcome/payout/settlement labels;
- validation or holdout artifacts;
- Current BUY or LINE state;
- primary or sidecar databases;
- network sources.

## Lineage verification

Before extracting values, the materializer verifies:

### Experiment-input manifest

- regular file, no symlink;
- mode 0600;
- bounded size;
- exact manifest digest and canonical digest;
- `EXPLORATION_ONLY` / `FULL_TRAJECTORY_ONLY` / `NO_OUTCOME_LABELS` policies;
- protected private/no-public/no-DB/no-BUY/no-LINE/no-automated-betting boundaries;
- race-count consistency.

### Referenced feature artifact

- exact private path from the manifest;
- regular file, no symlink;
- mode 0600 and bounded size;
- artifact version `n2-trifecta-private-market-feature-artifact-v2`;
- exact race identity;
- exact source-load digest and feature-artifact digest from the manifest;
- PASS status only;
- private/no-public/no-DB/no-BUY/no-LINE/no-automated-betting boundaries;
- canonical artifact digest;
- PASS feature sequence with exactly T-30/T-20/T-10/T-5 and three adjacent transitions;
- canonical sequence, snapshot and transition digests;
- 120-selection snapshot/move universes remain present in the private source artifact;
- PIT availability timestamps are valid and not later than capture timestamps;
- aggregate feature values are finite and satisfy basic range/count invariants.

Any mismatch fails closed before matrix creation.

## Feature schema v1

The matrix has **85 numeric columns**.

### Snapshot aggregates — 4 checkpoints × 13 = 52

For each of T-30, T-20, T-10 and T-5:

- normalized entropy;
- effective selection count;
- Herfindahl concentration;
- favorite odds;
- favorite gap ratio;
- top-1 / top-3 / top-5 / top-10 market-mass share;
- odds p10 / median / p90;
- p90:p10 odds spread.

### Adjacent transition aggregates — 3 transitions × 11 = 33

For T-30→T-20, T-20→T-10 and T-10→T-5:

- Jensen-Shannon divergence;
- total-variation distance;
- favorite-changed flag encoded 0/1;
- top-5 retained count;
- top-5 churn rate;
- median absolute log-odds move;
- maximum absolute log-odds move;
- market-mass-weighted absolute log-odds move;
- shortening selection count;
- lengthening selection count;
- unchanged selection count.

## Intentionally excluded from v1

The matrix does **not** copy:

- the 120-entry `selections[]` arrays;
- the 120-entry transition `moves[]` arrays;
- `favoriteSelection` categorical identity;
- outcome, payout, ROI or settlement labels;
- model scores or BUY decisions;
- validation or holdout membership.

Selection-level arrays remain in the private source artifact and are read only as part of artifact/digest integrity verification. They are not copied into the race-level matrix or stdout.

## Determinism

The feature column order is fixed by `n2-trifecta-private-market-exploration-feature-schema-v1` and has its own schema digest.

The matrix contains:

- manifest digest/version and source-as-of;
- feature schema version/digest and ordered column names;
- one row per manifest race;
- race identity, feature artifact digest, source-load digest;
- 85 numeric values;
- fixed private/exploration/no-label boundaries;
- matrix digest.

No generation timestamp is included, so the same verified manifest and feature artifacts produce the same matrix digest.

## Private persistence

With explicit `--write-private`, the immutable matrix is created mode 0600 at:

```text
data/private/trifecta-market-experiments/matrices/<manifestDigest>/<matrixDigest>.json
```

Creation is exclusive `wx`. If the digest-addressed path already exists, it must be byte-semantically equivalent to the expected matrix or the operation fails closed as a collision. The matrix is never overwritten in place.

## CLI

Preview/materialize in memory:

```bash
npx tsx scripts/build-n2-trifecta-private-market-exploration-matrix.ts \
  --manifest <manifestDigest>
```

Persist the private immutable matrix:

```bash
npx tsx scripts/build-n2-trifecta-private-market-exploration-matrix.ts \
  --manifest <manifestDigest> \
  --write-private
```

Stdout contains only schema and lineage metadata: manifest/matrix/schema digests, ordered column names, race identities and source/artifact digests. The 85 numeric row values are never printed.

## Safe next step

After multiple independent days are accumulated, a registered exploration can consume an immutable matrix digest and ask a narrow question such as whether late-market repricing adds incremental information beyond existing non-market features.

Before any predictive evaluation:

1. accumulate substantially more complete race trajectories;
2. register the hypothesis and analysis protocol;
3. keep exploration, validation and holdout cohorts disjoint and immutable;
4. attach outcomes only in a separate labeled evaluation artifact;
5. retain point-in-time lineage;
6. do not connect exploration matrices directly to Current BUY.

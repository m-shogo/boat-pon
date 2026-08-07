# N2 Private Trifecta Market Experiment Input Manifest

## Purpose

The private market-feature day index defines which race artifacts exist and whether their checkpoint trajectories are complete. Offline research needs one more boundary before feature vectors are loaded: a frozen, reproducible cohort identity.

This manifest is that boundary. It selects only complete four-checkpoint races from explicitly named private day indices and records the source/index/artifact digests needed to reproduce the cohort later.

It is deliberately **not** an outcome dataset, validation set, holdout set, model-training dataset, promotion artifact, or BUY input.

## Evidence role

Version v1 is fixed to:

```text
evidenceRole: EXPLORATION_ONLY
coveragePolicy: FULL_TRAJECTORY_ONLY
labelPolicy: NO_OUTCOME_LABELS
selectionPolicy: ALL_PASS_RACES_FROM_EXPLICIT_DAY_INDICES
```

The builder has no option to relabel the cohort as validation or holdout and has no option to attach results, payouts, ROI, model scores or BUY decisions.

A future validation/holdout contract must be separate and must satisfy the existing research-governance separation rules.

## Input boundary

Inputs are explicit day scopes such as:

```text
2026-08-07:10
2026-08-08:10
```

Each scope resolves only to:

```text
data/private/trifecta-market-features/<date>/<venue>/index.json
```

The builder validates each day index before cohort assembly:

- regular file and no symlink;
- mode 0600;
- bounded file size;
- exact index version/date/venue;
- 12 race records;
- private-only / no-public / no-network / no-DB / no-BUY / no-LINE / no-automated-betting boundaries;
- canonical index digest;
- PASS/PARTIAL/NO_DATA count consistency;
- every selected PASS race has exact T-30/T-20/T-10/T-5 coverage;
- feature artifact version/path/source digest/artifact digest are present and well-formed.

Only PASS races enter the cohort. PARTIAL and NO_DATA races remain visible in their source day index but are not selected.

## Manifest contents

The manifest stores only lineage and cohort identity:

- source day scopes;
- source day-index relative path, digest and generation time;
- source PASS/PARTIAL/NO_DATA counts;
- selected race identity/date/venue/race number;
- fixed four-checkpoint coverage;
- feature artifact relative path/version/digest;
- feature source-load digest;
- fixed exploration/private boundary fields;
- manifest digest.

It does not store:

- raw BOAT RACE HTML;
- capture envelopes;
- accepted-marker contents;
- feature snapshots or transitions;
- per-selection odds or market-mass vectors;
- result/payout/settlement labels;
- ROI;
- validation or holdout membership;
- Current BUY decisions.

The manifest builder reads day indices only. Full private feature artifacts are not opened at this stage.

## Determinism and immutability

Input scopes are normalized and sorted before assembly. Selected races are sorted by race identity. `sourceAsOf` is derived from the latest source-index generation timestamp.

Therefore the same verified source day indices produce the same manifest digest regardless of CLI input order.

The manifest path is digest-addressed:

```text
data/private/trifecta-market-experiments/manifests/<manifestDigest>.json
```

With `--write-private`, creation uses exclusive mode-0600 `wx`. An existing path must contain the exact same manifest or the operation fails closed as a digest collision. The writer does not overwrite an experiment-input manifest.

## Usage

Preview one day:

```bash
npx tsx scripts/build-n2-trifecta-private-market-experiment-input-manifest.ts \
  --index 2026-08-07:10
```

Preview multiple explicit days:

```bash
npx tsx scripts/build-n2-trifecta-private-market-experiment-input-manifest.ts \
  --index 2026-08-07:10 \
  --index 2026-08-08:10
```

Persist the immutable private manifest:

```bash
npx tsx scripts/build-n2-trifecta-private-market-experiment-input-manifest.ts \
  --index 2026-08-07:10 \
  --write-private
```

Stdout is metadata-only. Network requests and DB reads/writes remain zero. Raw capture evidence, feature vectors, outcome labels, validation data and holdout data are not read.

## Relationship to K3 evaluation memory

This is an initial versioned cohort-input primitive for K3. It improves reproducibility and historical/validation/holdout separation, but it is **not** the complete Forward Evaluation Vault described by the Research Knowledge Retention Contract.

The safe next sequence is:

1. accumulate more day indices;
2. freeze exploration cohorts with this manifest;
3. define a separate feature-materialization step that verifies each referenced feature artifact digest;
4. register a specific experiment question and protocol before analysis;
5. later define validation/holdout membership separately and immutably;
6. only after adequate evidence, consider a governed Transfer Experiment;
7. never connect this manifest directly to Current BUY.

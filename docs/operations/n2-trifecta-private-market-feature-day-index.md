# N2 Private Trifecta Market Feature Day Index

## Purpose

The private market-feature artifacts are intentionally race-scoped and contain full private feature sequences. Offline experiments should not need to rediscover daily coverage by rescanning raw capture evidence on every run.

The day index provides a verified, digest-bound private manifest for one date and one venue. It references the race artifacts without copying per-selection odds or feature vectors into the index.

## Input boundary

The index reads only private v2 derived artifacts:

```text
data/private/trifecta-market-features/<date>/<venue>/<race>.json
```

It does not read:

- raw BOAT RACE HTML;
- capture envelopes or accepted-marker files;
- the primary DB or sidecar DB;
- Current BUY, LINE or public data;
- network sources.

The private feature artifacts themselves are read locally so their digest and coverage can be verified, but their feature vectors are never printed by the index CLI and are not copied into the index.

## Per-race verification

For every existing race artifact the index verifies:

- regular file, no symlink;
- mode 0600;
- bounded file size;
- artifact version `n2-trifecta-private-market-feature-artifact-v2`;
- exact date / venue / race identity;
- PASS or PARTIAL status only;
- valid source-load digest and artifact digest;
- fixed private-only / no-public / no-DB / no-BUY / no-LINE / no-automated-betting boundaries;
- complete partition of T-30 / T-20 / T-10 / T-5 into available and missing checkpoints;
- snapshot count equals available checkpoint count;
- transition count equals `max(0, snapshotCount - 1)`;
- PASS means all four checkpoints; PARTIAL means one to three checkpoints;
- canonical artifact digest matches the full private artifact.

A missing race artifact is represented as `NO_DATA`. A malformed, tampered or permission-widened existing artifact fails closed; it is not downgraded to `NO_DATA`.

## Index contents

The index contains only research-manifest metadata:

- date and venue;
- race number and race identity;
- PASS / PARTIAL / NO_DATA;
- available and missing checkpoint labels;
- snapshot and transition counts;
- source-load digest;
- feature artifact digest and version;
- private artifact relative path;
- aggregate PASS/PARTIAL/NO_DATA counts;
- aggregate snapshot and transition counts;
- fixed protected-boundary flags;
- index digest.

It does not copy snapshots, transitions, per-selection odds, ranks, market-mass vectors or other full feature values.

## Storage

With explicit `--write-private`, the index is atomically written mode 0600 to:

```text
data/private/trifecta-market-features/<date>/<venue>/index.json
```

The writer uses a same-directory temporary file, `fsync`, atomic rename and final permission verification. Existing symlink/non-file targets are rejected.

## Usage

Read-only preview:

```bash
npx tsx scripts/build-n2-trifecta-private-market-feature-day-index.ts \
  --date 2026-08-07 \
  --venue 10
```

Create or refresh the private index:

```bash
npx tsx scripts/build-n2-trifecta-private-market-feature-day-index.ts \
  --date 2026-08-07 \
  --venue 10 \
  --write-private
```

The CLI prints only the metadata listed above. It performs no network request or database read/write and never prints or publishes raw odds or full private feature vectors.

## Research role

This index is the intended next boundary between live/private capture engineering and offline experiment assembly. A future dataset builder can consume verified day indices, select only eligible races/checkpoint coverage, and preserve source/artifact digests for reproducibility without touching Current BUY or production decision paths.

Promotion to model/selector/BUY remains a separate governed process requiring point-in-time validation, experiment registration, holdout evidence and explicit production approval.

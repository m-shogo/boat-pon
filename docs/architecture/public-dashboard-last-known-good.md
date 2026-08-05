# Public dashboard last-known-good publication

## Purpose

The public dashboard must not disappear or display fabricated state merely because the newest publication attempt is corrupt, incomplete or unavailable.

The publication boundary therefore maintains two verified files:

- `public/public-data/latest.json`
- `public/public-data/last-known-good.json`

Both contain the same successfully published, SHA-256 verified `public-dashboard-snapshot-v1` document. The browser reads `latest.json` first and uses `last-known-good.json` only when the latest file cannot be fetched or fails schema, digest or future-time validation.

## Publication sequence

1. Generate a candidate with `scripts/export-public-dashboard-snapshot.ts`.
2. Validate the candidate schema and SHA-256 digest.
3. Reject future `generatedAt` / `dataAsOf` values.
4. If an existing last-known-good snapshot is valid, reject a candidate whose `dataAsOf` moves backwards.
5. Write both destination files through temporary files in their destination directories.
6. Rename `last-known-good` first, then `latest`.

A failure before validation completes performs no destination writes. A process interruption between the two final renames can leave an older valid `latest` and newer valid `last-known-good`; this is degraded but safe and is corrected by the next successful publication.

## Commands

```bash
node --import tsx scripts/export-public-dashboard-snapshot.ts \
  --catalog automation/task-catalog.json \
  --queue-state /path/to/automation/control/task-queue-state.json \
  --current-run /path/to/automation/control/current-run.json \
  --readiness reports/automation/pre-schedule-readiness.json \
  --output /tmp/boat-pon-public-candidate.json \
  --model-version "boat-pon-main:<sha>"

node --import tsx scripts/publish-public-dashboard-snapshot.ts \
  --candidate /tmp/boat-pon-public-candidate.json \
  --latest public/public-data/latest.json \
  --last-known-good public/public-data/last-known-good.json
```

`--now <ISO-8601>` exists for deterministic tests and controlled replay. Normal operation must omit it.

## Browser semantics

- Valid latest snapshot: source is `LATEST VERIFIED`.
- Invalid or unavailable latest plus valid fallback: source is `LAST-KNOWN-GOOD` and a visible warning is shown.
- Both invalid or unavailable: no values are inferred; the dashboard displays `NOT_AVAILABLE`.
- A valid but old snapshot remains visible as `STALE`; publication time never refreshes the authority timestamp.

## Prohibited coupling

The publisher and browser fallback must not:

- read the operational database or research sidecar;
- import model, selector, decision or production code;
- change Current BUY or LINE content, timing or delivery;
- expose exact selections, stake, current/required odds, internal thresholds or private diagnostics;
- commit frequently changing snapshots to `main` as an authority source;
- deploy to Cloudflare until a separate deployment path and credentials are explicitly configured.

## Validation

The test suite covers:

- schema and digest verification;
- content tampering;
- future-time rejection;
- rollback rejection against an existing last-known-good snapshot;
- atomic successful publication;
- byte-for-byte preservation of both destination files after invalid input;
- latest-to-last-known-good browser fallback;
- fail-closed behavior when both network files are invalid.

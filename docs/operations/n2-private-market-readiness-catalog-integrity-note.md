# N2 Readiness Catalog — Integrity Note

The catalog's `latest` entry is a navigation pointer, not a trust shortcut and not evidence deletion.

Before a readiness snapshot can participate in catalog construction, every discovered private source artifact must independently pass:

- regular non-symlink mode `0600` file checks;
- digest filename and `outputDigest` agreement;
- canonical self-digest verification;
- path date/venue scope agreement;
- race/cohort/48-checkpoint accounting;
- protected-boundary validation.

Only after all source artifacts pass is the greatest verified `checkedAt` selected for each date+venue entry. `scopeArtifactCount` retains visibility that older immutable snapshots exist.

A latest pointer never authorizes automatic cohort freezing, outcome labeling, validation/holdout access, Current BUY, LINE, public publication, automated betting, database mutation, or production application.

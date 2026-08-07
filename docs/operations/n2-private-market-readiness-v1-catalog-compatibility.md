# N2 Daily Readiness v1 — Catalog Compatibility

`n2-trifecta-private-market-daily-readiness-v1` does **not** define a `privateResearchOnly` field.

A readiness v1 source is eligible for the private catalog only after the catalog independently verifies:

- it is discovered under the fixed private readiness root and path scope;
- it is a regular non-symlink mode `0600` file;
- its digest filename matches `outputDigest`;
- its canonical body reproduces that digest;
- date/venue, race counts, cohort identities and 48-checkpoint accounting are valid;
- `automaticFreezeAuthorized`, outcome/validation/holdout/raw/publication/Current BUY/LINE/automated betting/production flags remain false and network/database counts remain zero.

The catalog must not silently extend an already-published v1 artifact contract by requiring fields that v1 never emitted. A future new required field belongs in an explicitly versioned readiness schema.

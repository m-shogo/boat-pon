# Durable Knowledge Completeness — Integrity Tiers

The retention audit intentionally applies different integrity semantics to immutable records and mutable latest-state heads.

## Append-only registry outputs

Files under `research/registries/` are durable identity records. Their authoritative `_digest` must reproduce from the canonical record body. A mismatch is structural corruption and the audit is `BLOCKED`.

## Mutable report/control outputs

Some existing `reports/n2/`, `reports/automation/`, and `automation/control/` paths are latest-state heads. A historical run can therefore reference a path whose current embedded `outputDigest` belongs to a later run.

That condition is recorded as `CURRENT_OUTPUT_DIGEST_SUPERSEDED`. The old immutable history record is still durable evidence that the earlier run happened, so the run is not automatically declared erased. However, it is not counted as strongly durable because the exact historical payload is no longer available at the mutable head path.

## Why the distinction matters

Treating all digest drift as corruption would create false BLOCK results for intentionally mutable heads. Treating registry drift as harmless supersession would hide true append-only corruption.

The audit therefore keeps both dimensions visible and never converts either result into research promotion, Current BUY, LINE, public publication, database mutation, automated betting, or production authority.

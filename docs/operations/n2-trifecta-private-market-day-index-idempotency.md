# N2 Private Market Day Index — Semantic Idempotency

The private market day index is a rebuildable derived artifact over verified private feature artifacts.

`generatedAt` records when a rebuild was requested. It is not new market evidence by itself.

Therefore, when an existing mode `0600` day index:

1. has a valid self-digest;
2. has a valid `generatedAt`;
3. is semantically identical to a newly rebuilt index after excluding only `generatedAt` and `indexDigest`;

its existing file and existing digest are reused.

This prevents an hourly feature-rollup run from creating a new day-index digest when no feature artifact changed.

The reuse path is fail-closed. A malformed, permission-invalid, unreadable, or self-digest-mismatched existing index is never accepted as semantically reusable. Because the day index is derived from verified private feature artifacts, such an index is rebuilt and atomically replaced.

This rule changes no raw evidence, Current BUY, LINE, public projection, database state, automated betting, outcome labels, validation data, or untouched holdout data.

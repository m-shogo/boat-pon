# Safe Growth Progress — 2026-08-05

Authority roadmap: `docs/roadmaps/safe-growth-implementation-roadmap-2026-08-05.md`

## Completed

### G0-A — Roadmap, BUY/LINE boundary and message contract

Merged to main:

- merge SHA: `dba25c4a6a81dd9fd00e0b27bd35f07b5baa1c01`
- PR: `#21`

Delivered:

- two-lane safe-growth roadmap;
- BUY/LINE/research reverse-dependency CI guard;
- versioned self-contained BUY LINE message contract;
- golden and validation tests;
- no live LINE integration or Current BUY behavior change.

### G2-A — Runtime Decision Ledger contract

Merged to main:

- merge SHA: `73db3e66e73d55d7f145f421944f1b9bf3561b3c`
- PR: `#22`

Delivered:

- TypeScript record contract and runtime validator;
- PIT ordering and BUY completeness checks;
- notification eligibility/dedupe constraints;
- unknown-field rejection;
- canonical SHA-256 digest;
- JSON Schema and alignment tests;
- no operational persistence or behavior change.

### G2-B — Read-only Runtime Decision Ledger shadow mapper

Merged to main:

- merge SHA: `d2e763bb1018857a36cb4d2badb217498d356a86`
- PR: `#23`

Delivered:

- explicit `decision_history` source-field inventory;
- deterministic pure mapper into `runtime-decision-ledger.0.1`;
- SQLite UTC and JST close-time normalization;
- fail-closed handling for updated decision rows;
- fail-closed proof that close time was visible at decision time;
- BUY/WATCH/SKIP validation and warning preservation;
- exact-duplicate dedupe and conflicting-identity failure;
- reconciliation counts and ordered record-set digest;
- read-only/query-only SQLite report command;
- atomic private JSON output with mode `0600`;
- SQL-write and protected-dependency safety tests;
- full CI, Research Replay, governance and build PASS.

### G2-C1 — Bounded shadow evidence execution contract

Merged to main:

- merge SHA: `108754541e30da369cc8ab857318cfc8eb3fde37`
- PR: `#25`

Delivered:

- strict `runtime-decision-ledger-shadow-evidence.0.1` TypeScript contract and validator;
- matching JSON Schema;
- finite date range and maximum 5,000-row evidence cohort;
- `limit + 1` truncation detection rather than silent partial PASS;
- active SQLite WAL fail-closed guard without checkpoint/removal;
- SQLite structural source descriptor and digest without local DB path;
- aggregate mapped/unresolved/rejected/conflict counts and rates;
- unresolved/rejected reason counts and stable reason taxonomy;
- sanitized evidence with no raw records, row IDs, race IDs, selections, outcome columns or absolute paths;
- local private append-only store with directory `0700`, file `0600`, exclusive create and deterministic identity;
- `data/private/` Git ignore;
- end-to-end temporary SQLite fixture test covering real command execution, evidence validation, private record retention and idempotent replay;
- architecture and operating documentation;
- full CI, Research Replay, governance and build PASS.

No operational DB write, permanent ledger table, automatic backfill, Current BUY/model/selector change, LINE delivery-state change, Outcome Learning linkage, Cloudflare projection or production promotion was introduced by G2-A through G2-C1.

## In progress

### G2-C2 — Mac-local bounded evidence measurement

Required sequence:

```text
bounded Mac-local DB execution
-> private append-only full report
-> sanitized validated evidence summary
-> measured completeness/reconciliation evidence
-> dominant unresolved-field classification
```

Chat/GitHub-only execution has not run the private Mac-local `data/boat.sqlite`, so no real mapped count, unresolved count, rejected count, conflict count or evidence verdict is claimed yet.

The isolated permanent Runtime Decision Ledger store remains a later design decision. It must not be added before real bounded evidence shows which identities and timestamps are recoverable.

### N2 control-plane recovery — stale intent supersession

The previous N2-010 intents were not merely waiting:

- `INTENT-20260805-k8m2q7v4pz` referenced authority `56f0b47`;
- `INTENT-20260805-z7m4q2p8kx` referenced authority `1184fa4`;
- current authority before the recovery slice was `00c6f4bcf891e00d0f8b6ffdb11727ca626b30b1`.

Because the guard accepts only current main or its immediate parent, both old intents are terminally stale and cannot execute successfully.

Current recovery slice:

```text
strict supersession contract + schema
-> equivalent-unprocessed-intent guard
-> immutable supersession record for both stale intents
-> one replacement intent INTENT-20260805-r4n8v2k6qx
-> PR CI
-> merge-triggered one-shot workflow
-> automation branch result readback
```

The replacement is allowed only when the old authority is stale and a matching supersession record exists. A still-current unprocessed intent remains a hard duplicate block.

Detailed authority: `docs/operations/n2-stale-intent-supersession-2026-08-05.md`.

## Scheduled N2 lane

State observed before the recovery PR merges:

- N2-001 through N2-006: `PASS`;
- N2-010 queue state: `READY`, `attemptCount=0`, no evidence links;
- old N2-010 intent files remain immutable and absent from the processed-intent ledger;
- replacement intent `INTENT-20260805-r4n8v2k6qx` is included in the recovery slice;
- N2-011 and later remain `BLOCKED_EXECUTOR_PENDING`.

The enabled hourly task must treat valid supersession records as terminal for pending-intent detection. It must continue to block any active unprocessed equivalent and must not create another N2-010 intent while the replacement is unprocessed.

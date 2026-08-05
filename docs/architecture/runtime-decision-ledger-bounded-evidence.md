# Runtime Decision Ledger — Bounded Shadow Evidence

Status: executable contract implemented; Mac-local evidence not yet measured
Date: 2026-08-05
Schema: `runtime-decision-ledger-shadow-evidence.0.1`

## Purpose

This slice turns the read-only Runtime Decision Ledger mapper into a bounded, reproducible evidence run without changing Current BUY, LINE or the operational database.

It answers four questions:

1. how many selected `decision_history` rows can be mapped safely;
2. how many remain unresolved because historical decision-time provenance is not provable;
3. how many are rejected by the strict ledger contract;
4. whether duplicate logical identities contain conflicting content.

It does not train a model, change a BUY rule or attach outcomes.

## Two outputs with different trust boundaries

### Local private append-only report

The full report may contain mapped ledger records and unresolved source-row IDs. It must remain on the Mac under the ignored private data root.

Recommended directory:

```text
data/private/runtime-decision-ledger/
```

The filename is derived from the source descriptor digest and evidence content digest. Creation uses exclusive mode (`wx`), file mode `0600` and directory mode `0700`.

- an existing file with the same evidence digest is treated as an idempotent replay;
- an existing filename with different evidence is a hard conflict;
- existing files are never replaced or deleted by the command;
- `data/private/` is Git-ignored.

### Sanitized evidence summary

The sanitized evidence contains only:

- bounded scope;
- SQLite structural descriptor and its digest;
- reconciliation counts and records digest;
- completeness rates;
- unresolved/rejected reason counts;
- high-level reason taxonomy;
- fixed privacy and non-interference assertions.

It never contains:

- mapped records;
- `decision_history` row IDs;
- race IDs;
- selections;
- local or absolute paths;
- result or payout columns;
- LINE delivery state;
- exact stake history.

This summary is safe to retain as research evidence after schema validation, but it is not a public-web payload.

## Bounded execution contract

Bounded evidence mode is enabled when either `--evidence-output` or `--private-store-dir` is supplied.

It requires:

- both `--from` and `--to`;
- `--limit <= 5000`;
- no active non-empty SQLite WAL;
- `DatabaseSync(..., { readOnly: true })`;
- `PRAGMA query_only = ON`;
- no `--line-eligible`;
- query result fetched as `limit + 1` so truncation is measured rather than guessed.

A WAL causes a fail-closed stop. The command does not checkpoint, remove or modify the WAL.

## Command

Example only; model version and dates must be selected from current local evidence:

```bash
npx tsx scripts/report-runtime-decision-ledger-shadow.ts \
  --db data/boat.sqlite \
  --run-kind paper-live \
  --model-version '<CURRENT_MODEL_VERSION>' \
  --from 2026-01-01 \
  --to 2026-08-05 \
  --limit 5000 \
  --private-store-dir data/private/runtime-decision-ledger \
  --evidence-output reports/research/runtime-decision-ledger-shadow-evidence.json
```

The command prints the sanitized evidence when bounded mode is active. It does not print the full private record set.

## Verdict semantics

### PASS

- at least one source row;
- no limit truncation;
- no unresolved rows;
- no rejected rows;
- no identity conflicts;
- mapper reconciliation is PASS.

### CONDITIONAL

Any of the following:

- source cohort is empty;
- row limit was reached;
- unresolved provenance exists;
- rejected rows exist;
- mapper reconciliation is CONDITIONAL.

`CONDITIONAL` is evidence, not failure. It identifies which historical fields must be preserved prospectively.

### FAILED

- conflicting content for the same ledger identity;
- mapper reconciliation is FAILED;
- evidence schema/digest/count validation fails;
- append-only store conflict.

## Reason taxonomy

Raw reason codes remain counted, and are also grouped into:

- `source_mutability` — a stored row appears to have been updated after its original creation time;
- `temporal_provenance` — close time, observation time or timezone cannot be proven at decision time;
- `identity_completeness` — required model or version identity is missing;
- `identity_conflict` — one logical record identity has different content;
- `schema_or_value` — source or ledger value violates the strict contract.

The taxonomy is descriptive. It cannot automatically relax validation or promote a strategy.

## Data queried

The bounded command reads only decision-time fields from `decision_history` and close-time provenance from `official_programs`.

It intentionally does not query:

- `decision_history.result`;
- `decision_history.payout_yen`;
- `decision_history.actually_bought`;
- actual `stake_yen`;
- `notification_log`;
- `app_settings`;
- public/Cloudflare data.

Outcome attachment belongs to the separate Outcome Learning Ledger.

## Current completion state

Implemented and CI-testable:

- evidence TypeScript contract and validator;
- JSON Schema;
- deterministic content digest independent of generation timestamp;
- bounded/truncation detection;
- WAL fail-closed rule;
- sanitized reason aggregation;
- append-only private store;
- private data Git ignore;
- syntax, SQL-write, protected-dependency and evidence tests.

Not yet claimed:

- execution against the Mac-local `data/boat.sqlite`;
- measured mapped/unresolved/rejected/conflict counts;
- a PASS or CONDITIONAL verdict from real data;
- permanent ledger persistence;
- outcome linkage.

## Next safe step

After this code merges, run one bounded Mac-local cohort and retain:

```text
private append-only full report
+ sanitized validated evidence summary
+ command/version/source descriptor digest
```

Then classify the dominant unresolved reasons before designing a permanent append-only Runtime Decision Ledger store.

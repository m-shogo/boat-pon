# Runtime Decision Ledger Shadow Mapper

Status: implemented as read-only/shadow-only
Date: 2026-08-05
Depends on: `runtime-decision-ledger.0.1`

## Purpose

Map existing `decision_history` evidence into the Runtime Decision Ledger contract without changing Current BUY, LINE notification state, the operational SQLite database, automation authority state or production behavior.

The mapper is an evidence-reconciliation tool. It is not a backfill writer, selector, trainer or promotion path.

## Implementation

- pure mapper and reconciliation: `src/research/governance/runtimeDecisionLedgerMapper.ts`
- mapper tests: `src/research/governance/runtimeDecisionLedgerMapper.test.ts`
- read-only report command: `scripts/report-runtime-decision-ledger-shadow.ts`

## Read-only execution

The report command:

1. opens the configured SQLite database with `{ readOnly: true }`;
2. enables `PRAGMA query_only = ON`;
3. applies a short `busy_timeout`;
4. reads `decision_history` joined to `official_programs`;
5. maps and validates records in memory;
6. writes only an optional external JSON artifact using atomic rename and mode `0600`.

It never imports `server/db.ts`, because `openDb()` migrates and seeds the operational database. It contains no `INSERT`, `UPDATE`, `DELETE`, schema migration, LINE send or public-deploy path.

## Source field inventory

| Ledger meaning | Source | Rule |
|---|---|---|
| source identity | `decision_history.id` | positive integer required |
| canonical race | `decision_history.race_id` | preserved verbatim |
| ticket | `bet_type`, `selection` | required |
| decision | `decision` | only BUY/WATCH/SKIP |
| decision time | `created_at` | SQLite UTC timestamp normalized to ISO |
| odds observation | `fetched_at` | must be timezone-explicit or SQLite UTC; must not be later than `created_at` |
| close observed | `official_programs.close_at` | `HH:mm`/`HH:mm:ss` interpreted in JST using race date |
| proof close was available | `official_programs.imported_at` | must be at or before decision time |
| price/probability/EV | persisted decision columns | finite-value and BUY completeness validation |
| reasons | `decision_reasons` | malformed JSON becomes a warning, never invented text |
| feature audit | `feature_adjustment`, `feature_adjustment_breakdown` | retained as source digest/warnings; not converted into new decision logic |
| model | `model_version` | missing value is unresolved |
| outcome/result | deliberately excluded | belongs to Outcome Learning Ledger, not decision-time record |

## Fail-closed ambiguity handling

### Updated operational rows

`insertDecisionHistory()` can update an existing row while leaving its original `created_at` unchanged. The update replaces `fetched_at` and decision values.

Therefore, when `fetched_at > created_at`, the shadow mapper does not pretend the row is an immutable decision-time snapshot. It reports:

`source_row_update_or_odds_observation_after_created_at`

### Replaced program rows

`official_programs` uses replacement semantics and stores only the current row. A current close time must not be projected backward into an earlier decision.

When `official_programs.imported_at > decision_history.created_at`, the mapper reports:

`close_time_not_proven_visible_at_decision`

A missing program row or timestamp is also unresolved. No close time is guessed.

## Reconciliation statuses

- `PASS`: every source row mapped, with no conflicts;
- `CONDITIONAL`: one or more rows are unresolved or rejected, but no logical-identity conflict exists;
- `FAILED`: the same deterministic `recordId` maps to different ledger digests.

Exact duplicate rows are counted and deduplicated. Conflicting duplicates fail closed.

The report includes:

- source count;
- unique mapped count;
- exact duplicate count;
- unresolved count/reasons;
- rejected count/reasons;
- conflict count/details;
- deterministic digest of the ordered record set.

## Example

```bash
npx tsx scripts/report-runtime-decision-ledger-shadow.ts \
  --run-kind paper-live \
  --model-version v4-conservative \
  --from 2026-08-01 \
  --to 2026-08-05 \
  --line-eligible \
  --output tmp/runtime-decision-ledger-shadow.json
```

The generated artifact is private operational/research evidence. Do not commit it to Git or publish it to Cloudflare.

## Current limitations

- No operational persistence table exists for the Runtime Decision Ledger.
- Existing updated rows may remain unresolved because no immutable per-update history exists.
- The program table does not retain every historical close-time version.
- Notification eligibility is recorded only when explicitly enabled; delivery state remains in `notification_log`.
- Strategy/manifest/cohort identities are shadow labels until future formal authorities are connected.

## Next safe slice

1. run this report against the local DB using bounded date/model/run-kind cohorts;
2. inspect mapped/unresolved/rejected/conflict counts;
3. add a fixture-backed source completeness report;
4. only then design an isolated append-only ledger store;
5. persistence failure must remain unable to affect BUY or LINE.

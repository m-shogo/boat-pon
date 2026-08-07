# Research Durable Knowledge Completeness Audit

Status: research retention audit contract  
Scope: persisted automation history and referenced durable outputs  
Production authority: none

## Purpose

Boat Pon already requires scheduled research to leave durable knowledge rather than only a chat/status message. This audit makes that requirement measurable over persisted automation history.

It answers:

> For each persisted research automation run, did the repository retain enough immutable history and referenced artifacts to reconstruct what happened, what was blocked, or what evidence was produced?

It does **not** evaluate strategy quality, ROI, BUY decisions, or promotion eligibility.

## Source authority

The audit reads only:

```text
reports/automation/history/<runId>-<taskId>.json
```

and output references inside those histories when they remain under approved durable roots:

- `reports/n2/`
- `reports/automation/`
- `research/registries/`
- `automation/control/`

It does not read raw/private market evidence, sidecar databases, production settings, Current BUY, or LINE state.

## History validation

Every persisted history must provide a coherent execution identity:

- numeric `runId`;
- non-empty request/intent identity;
- `TASK-*` task identity;
- task type, safety level, executor version;
- `executed=true`;
- result from the runner contract (`PASS`, `DRY_RUN_OK`, `CONDITIONAL`, `BLOCKED`, `FAILED`);
- string arrays for blocks and outputs;
- 64-hex output digest and idempotency key;
- 40-hex authority SHA;
- valid ordered start/completion times and non-negative elapsed time;
- filename identity matching `runId` and `taskId`;
- safe unique output paths restricted to approved roots.

Persisted `DRY_RUN_OK` is a structural violation because dry-run is explicitly non-persistent in the executor contract.

## Durable classifications

### `PASS_DURABLE_OUTPUTS`

A PASS references one or more existing valid durable outputs.

For mutable report/control heads, the current file may be newer than the old run. The audit distinguishes:

- `CURRENT_OUTPUT_DIGEST_MATCH`: current artifact still represents that run;
- `CURRENT_OUTPUT_DIGEST_SUPERSEDED`: the path exists but a later run replaced the mutable head.

Supersession does not erase the old history record, but it lowers **strong** retention because the exact old payload is no longer available at that mutable path.

### `PASS_NO_CHANGE_HISTORY`

A PASS with no output is durable only when the summary explicitly says no change, for example `NO_CHANGE_*` or `noChange=true`. The immutable history itself is the durable fact that the deterministic run found nothing new to write.

### `NON_PASS_DURABLE_HISTORY`

A BLOCKED/FAILED history with explicit blockers is durable negative/engineering evidence even with no output artifact. CONDITIONAL is durable when it retains blockers, a substantive summary, or verified outputs.

### Incomplete/invalid

- `INCOMPLETE_PASS_NO_OUTPUT`: PASS claimed without output or explicit no-change evidence;
- `INCOMPLETE_OUTPUT_REFERENCE`: required referenced output is missing or invalid;
- `INVALID_PERSISTED_DRY_RUN`: persisted dry-run result;
- `INVALID_HISTORY`: malformed execution history.

## Append-only registry verification

Outputs under `research/registries/` are treated more strictly than mutable reports.

The audit requires each registry record to reproduce its `_digest` using the authoritative research-governance `contractDigest` after removing registry metadata. A tampered registry is BLOCKED, not merely degraded.

## Mutable report supersession

Many existing `reports/n2/*.json` files are intentionally mutable latest-state heads. An old history can therefore reference a path whose current embedded `outputDigest` belongs to a later run.

The audit does **not** call that automatic knowledge loss. Instead it records a superseded-reference warning and marks the run durable but not strongly durable.

This exposes a useful future hardening signal: high-value outputs that need exact historical replay can later migrate to append-only/content-addressed evidence without falsely declaring all existing mutable history invalid today.

## Aggregate status

`PASS`
: all persisted runs are durably classifiable and no mutable supersession/incomplete references are present.

`DEGRADED`
: history is structurally valid but one or more runs are incomplete, reference missing outputs, or point at mutable artifacts superseded by later runs.

`BLOCKED`
: malformed history, persisted dry-run, or invalid/corrupt existing referenced output is present.

`NO_HISTORY`
: no persisted automation history exists at the audited root.

A DEGRADED result is a retention-quality finding, not a strategy failure and not permission to modify production.

## Safety boundary

The audit is read-only and fixes:

- `evidenceRole = RESEARCH_KNOWLEDGE_RETENTION_AUDIT_ONLY`
- `automaticPromotionAuthorized = false`
- `currentBuyConnectionAuthorized = false`
- `lineConnectionAuthorized = false`
- `publicPublishAuthorized = false`
- `databaseWriteAuthorized = false`
- `automatedBettingAuthorized = false`
- `productionApplyAuthorized = false`

It performs no network requests or database access and cannot update queue state, registries, reports, Current BUY, or production.

## Manual use

```bash
node node_modules/tsx/dist/cli.mjs \
  scripts/audit-research-durable-knowledge-completeness.ts \
  --repo-root /path/to/research-state-checkout
```

The intended first live audit target is the persisted `automation/boat-pon-research` state branch. Persistent scheduling or report publication should only be added after that live audit confirms the real history/output shapes.

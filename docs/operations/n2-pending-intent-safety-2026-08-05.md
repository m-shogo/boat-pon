# N2 Pending Intent Safety — 2026-08-05

Status: active operational safeguard
Scope: ChatGPT hourly orchestrator → GitHub intent → Mac self-hosted runner

## Current observed state

At the time of this record:

- `TASK-N2-001` through `TASK-N2-006`: `PASS`;
- `TASK-N2-010`: queue authority remains `READY`, `attemptCount=0`, no evidence links;
- main contains valid intent `INTENT-20260805-z7m4q2p8kx` for `TASK-N2-010`;
- that intent is not present in `automation/control/processed-intents.json`;
- no PASS, FAILED or terminal runner evidence has been observed for that intent;
- therefore the correct status is `PENDING_RUNNER` / `PENDING_WORKFLOW_CONFIRMATION`, not PASS and not a confirmed failure.

The engineering lane did not create another N2-010 intent and did not directly modify automation branch state.

## Required orchestrator behavior

Before selecting or committing a new task intent, the hourly ChatGPT orchestrator must:

1. read all valid main intents under `automation/requests/intents/`;
2. read the automation-branch processed-intent ledger;
3. subtract processed IDs from valid intent IDs;
4. treat the remaining set as unprocessed/pending intents;
5. if an unprocessed `run-task` intent exists for the candidate task, do not create another intent even if queue state is still `READY`;
6. wait for processed-ledger or explicit terminal evidence;
7. never edit, delete or reuse an immutable intent to simulate a retry.

`CLAIMED` / `RUNNING` detection remains required, but it is not sufficient because an accepted workflow can be waiting for the self-hosted runner before queue state changes.

## Status vocabulary

- `PENDING_RUNNER`: valid unprocessed intent exists and no terminal evidence exists;
- `PENDING_WORKFLOW_CONFIRMATION`: intent exists but workflow/runner state cannot be directly confirmed;
- `PASS`: expected artifacts, state transition, processed ledger and evidence all verify;
- `FAILED`: explicit workflow/runner failure evidence exists;
- `BLOCKED`: a defined safety, resource, executor or data-contract blocker exists.

Absence of branch-state progress alone is not proof of failure.

## Duplicate prevention

While `INTENT-20260805-z7m4q2p8kx` remains valid and unprocessed:

- no new N2-010 intent is permitted;
- the same pending status must not generate hourly user notifications;
- planner fallback must not run merely because N2-010 still appears `READY`;
- Current BUY, LINE, sidecar, `app_settings` and production remain untouched.

## Recovery boundary

A new intent may be considered only after one of these is observed and recorded:

1. the existing intent is processed with PASS/CONDITIONAL/FAILED/BLOCKED evidence;
2. explicit terminal workflow evidence proves it cannot run and the recovery path requires a fresh intent;
3. catalog or task definition changes invalidate the old request and governance records the invalidation.

Do not infer a terminal state from elapsed time alone.

## Scheduled task synchronization

The enabled `Boat Pon N2研究` hourly task was updated on 2026-08-05 to apply this pending-intent check before every write and to preserve the existing L0–L2, one-intent, no-production, no-sidecar-write and no-auto-betting rules.

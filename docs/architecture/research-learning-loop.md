# Research Learning Loop

Status: authoritative operating contract  
Scope: hourly/scheduled research engineering and governance work  
Production authority: none

## Purpose

Boat Pon must not merely retain history. The next run must use prior outcomes to change what it does.

A chat report, green CI result, failed workflow, or Markdown note is not by itself a learning loop. Learning exists only when a durable prior outcome can be retrieved before the next equivalent attempt and can change that attempt.

## Durable identity

Meaningful failures and non-obvious reusable successes are stored as append-only `LEARN-*` records under:

`research/registries/learnings/`

Each record has a canonical digest and is validated by the normal research registry governance path.

The normalized fingerprint is:

`fingerprintKey + attemptSignature + authorityState(environmentKey, materialStateKey)`

`mainSha` is retained as evidence, but it is not the reset key. `materialStateKey` must identify the code/config/runtime state that could plausibly change the root cause.

Use semantic fingerprint keys. Do not encode secrets, private raw paths, odds values, timestamps, random IDs, or race keys into the fingerprint.

## Required pre-attempt gate

Before retrying a meaningful failure or choosing a materially equivalent method:

1. read the latest main/open PR/CI/automation state;
2. read this contract and relevant `LEARN-*`, Experiment, Discovery, and Rejection records;
3. normalize the candidate attempt;
4. evaluate prior learning;
5. act on the gate result before doing the work.

Gate semantics:

- no matching learning: `PROCEED`;
- one unchanged matching failure: `SWITCH_METHOD`;
- two unchanged matching failures: `BLOCK_REPEAT` — a third identical attempt is prohibited;
- latest matching `VERIFIED_SUCCESS + REUSE_VERIFIED_GUARDRAIL`: `REUSE_GUARDRAIL` first.

An unrelated new main SHA never resets the gate. A retry is materially changed only when `environmentKey` or `materialStateKey` changes for a reason that plausibly affects the fingerprint's root cause.

Protected N2 runs must never be consumed merely to discover whether an unchanged failure repeats.

## Result classification

Persist a new Learning record only when it changes future decisions:

- `NEW_FAILURE`: a meaningful new failure/root-cause class or an existing fingerprint under a materially changed authority;
- `VERIFIED_SUCCESS`: a non-obvious cause → change → verification pattern worth reusing;
- `REPEATED_FAILURE_AVOIDED`: useful evidence that a prior gate prevented an otherwise repeated attempt;
- `TRANSIENT_UNCLASSIFIED`: a meaningful anomaly with insufficient root-cause evidence.

Routine green CI, ordinary status reads, and `NO_NEW_LEARNING` do not deserve a new record.

## Failure interpretation

Separate these layers:

1. research payload/result;
2. command/process exit result;
3. workflow/job conclusion;
4. post-job infrastructure such as checkout/cache cleanup;
5. external runner/platform state.

Do not call a research method failed solely because layer 3 is red. Inspect full logs and establish which layer failed.

Do not call an anomaly transient merely because every visible step says success. Look for post-job errors and runner/platform evidence.

## Success interpretation

A green run is not automatically a reusable success.

A `VERIFIED_SUCCESS` requires:

- the intended change actually ran;
- the relevant regression/contract check passed;
- evidence references identify the verification;
- the guardrail explains what future work should reuse;
- no production authority is inferred.

## Safety

Learning records:

- never authorize Current BUY, LINE, public publishing, automated betting, or production apply;
- keep `productionConnection=false`;
- contain metadata/evidence references only, never private raw values or private filesystem paths;
- remain append-only and digest protected;
- do not replace Experiment/Discovery/Rejection lineage.

## Relationship to legacy lessons

`docs/lessons-learned.md` remains useful narrative/history, especially for older modeling work. It is not the machine decision gate for hourly research.

For current automation, the canonical repeat-suppression authority is this contract plus `research/registries/learnings/`.

## End-of-run requirement

Every run reports a compact Learning line:

`classification | fingerprint | gate action | reused learning id | new learning id (if any)`

If a meaningful new failure or reusable success occurred, its durable record must exist before claiming that the system learned from it.

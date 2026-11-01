# Research governance — green natural rollup versus missing day-index readiness (2026-11-01 JST)

**Disposition: REUSED_LEARNING / NO_NEW_LEARNING; ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Read-only comparison of already completed natural GitHub Actions runs. No workflow dispatch/rerun, protected N2 activation, private dataset/path/odds access, Current BUY, LINE, public, betting, production, or Owner Dashboard change.

## Question

Does a **green upstream Feature Rollup workflow** prove that the downstream N2 Daily Readiness dependency was restored?

**No.** The full job logs for the following natural runs were read and the relevant public status/reason fields checked without copying private values, paths, digests, or counts:

| Natural run (UTC) | Workflow/job | Research payload evidence | Cleanup |
| --- | --- | --- | --- |
| [Feature Rollup #41190215399](https://github.com/m-shogo/boat-pon/actions/runs/41190215399), 2026-10-31 09:48 | SUCCESS / SUCCESS | Report `status=NO_DATA`; no positive day-index-restoration proof | Post Checkout SUCCESS |
| [Feature Rollup #41216522153](https://github.com/m-shogo/boat-pon/actions/runs/41216522153), 2026-10-31 15:47 | SUCCESS / SUCCESS | Report `status=NO_CHANGE` and reason `PRIVATE_DAILY_PLAN_NOT_AVAILABLE`; no positive day-index-restoration proof | Post Checkout SUCCESS |
| [Daily Readiness #41230870918](https://github.com/m-shogo/boat-pon/actions/runs/41230870918), 2026-10-31 18:44 | FAILURE / FAILURE | Full job log explicitly raises `DAILY_READINESS_DAY_INDEX_MISSING`, command exit **1**, catalog step SKIPPED | Post Checkout SUCCESS |

A successful upstream **process/workflow** is therefore not equivalent to a positive upstream **material-state transition**. The earlier rollup's `NO_DATA` and later rollup's `NO_CHANGE` are not themselves proof of which local file existed at downstream runtime; the downstream missing-index exception supplies the direct payload evidence. There is no demonstrated runner/platform crash or post-job cleanup failure in these three logs.

## Reuse gate

- `fingerprintKey=n2.daily-readiness.required-day-index-missing`
- `attemptSignature=read-only-compare-natural-feature-rollup-payload-status-and-downstream-readiness-log`
- `environmentKey=github-actions/self-hosted-macos-node24/read-only`
- `materialStateKey=natural-rollup-NO_DATA-NO_CHANGE-without-restoration-proof/downstream-required-index-missing`
- `REUSE_GUARDRAIL / BLOCK_UNCHANGED_DIAGNOSTIC_RETRY`: apply `LEARN-n2-daily-readiness-day-index-missing-20260920` and `LEARN-n2-daily-readiness-day-index-restored-20260921`. Their remedy is verified **material restoration** through a normal upstream process, then the next natural schedule, never a forced protected retry.
- `REUSED_LEARNING / NO_NEW_LEARNING`: this is additional evidence for the existing dependency/interpretation guardrail, not a new distinct failure root class or non-obvious engineering remediation success. No duplicate LEARN record.

Latest canonical main at the read/write gate: `2342494f6581c167a5648681ca7374b26d6659d4`. Draft research PR #2286 remains separate from LINE-owned #2287; neither may be merged on this evidence. The prior full-log [readback report](https://github.com/m-shogo/boat-pon/blob/research/forward-vault-atomic-readback/reports/research/forward-v02-pr2286-natural-n2-day-index-red-run-readback-20261101.md) provides the downstream process and post-job layers.

## Safe next action

Observe only normal upstream rollup **payload status and verified day-index material evidence**, not just its green workflow conclusion. Wait for an authorized material change and the next natural readiness execution. Do not activate or rerun protected N2 for diagnostics, infer readiness counts, score forward evidence, or alter production settings. K issuer rights, independent ticket settlement/correction/finality, frozen cohort, and approved scoring protocol remain unverified; keep `productionConnection=false` and `DO_NOT_MERGE_CANDIDATE`.

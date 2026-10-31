# Forward Vault research governance — natural N2 red-run evidence-layer separation (2026-10-31 JST)

**Disposition: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Read-only, metadata-and-log forensic audit. This report does not diagnose, activate, rerun, repair or change protected N2; does not read private data or assert readiness counts. No Current BUY, LINE, public publishing, automated betting, production behavior/settings, Owner Dashboard, raw T-5 odds, secrets or private paths were accessed or changed.

## Question

Can the latest observed scheduled N2 Daily Readiness failure be attributed to the same missing upstream day-index dependency proven in an earlier natural run, or to post-job/runner infrastructure, from the currently retrievable GitHub evidence?

**No.** The latest run has a failing research-evidence step and a failed job/workflow, but its full job-log blob currently returns HTTP 404 `BlobNotFound`. An older natural run *does* have a complete log proving `MISSING:DAILY_PLAN_MISSING` and process exit 3. Similar step names are insufficient to transfer that root cause to the newer run. A completed-run job-step snapshot also shows a post-checkout step as `in_progress`/null; that inconsistency is **not** evidence that post-job infrastructure caused the primary failure.

## Layered, independently retrievable observations

| Evidence layer | Earlier natural run [#40218434947](https://github.com/m-shogo/boat-pon/actions/runs/40218434947) (2026-10-25 UTC) | Later natural run [#41117305706](https://github.com/m-shogo/boat-pon/actions/runs/41117305706) (2026-10-30 UTC) |
| --- | --- | --- |
| Research payload | Full job log: required daily plan unavailable, `MISSING:DAILY_PLAN_MISSING` | Evidence-building step marked failure; exact payload diagnostic **unknown** because full job log unavailable |
| Process exit | Full job log: exit **3** | **Unknown**; cannot infer exit code from step conclusion |
| Job / workflow | `readiness` FAILURE / workflow FAILURE | `readiness` FAILURE / workflow FAILURE |
| Downstream catalog | Skipped | Skipped |
| Post-job | Checkout cleanup SUCCESS and complete-job SUCCESS in job metadata and log | Setup-node post-step skipped; post-checkout `in_progress`/null in retrieved job-step snapshot even though run/job are completed. Cleanup outcome **unresolved**, not proven failure |
| Runner / platform | Self-hosted macOS runner, log contains no demonstrated runner crash | Self-hosted macOS runner named in job metadata; no available full log or platform incident evidence proving a runner cause |

The later workflow run metadata is `status=completed`, `conclusion=failure`, `run_attempt=1`, and its `Build private readiness evidence` step is `conclusion=failure`. GitHub's decoded job-log endpoint for its readiness job returned HTTP 404 with `BlobNotFound` on 2026-10-31 UTC; no blind retry, diagnostic dispatch or inference from a missing blob was made. The earlier run's decoded log was retrieved in full and inspected; it proves only the earlier missing-plan case. Neither run establishes private readiness or forward-scoring eligibility.

## Learning / repetition gate

- Latest canonical main at the pre-write gate: `2342494f6581c167a5648681ca7374b26d6659d4`; Draft research PR #2286 pre-write HEAD `b076838c47fb5a1919da0557794575eb160e6612`; separate open #2287 is LINE-owned. Merged research PRs #2284/#2285 remain the latest main Forward Vault foundation. Latest pre-write research PR CI [#41186752097](https://github.com/m-shogo/boat-pon/actions/runs/41186752097) succeeded on that HEAD, including Verify, governance and post-job cleanup; this does **not** validate a later report commit.
- Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`; historical `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` are unrelated dataset inventory, not current N2 runtime evidence. No substantive Rejection registry record supplies a new diagnosis.
- Reused `LEARN-n2-daily-readiness-day-index-missing-20260920` and `LEARN-n2-daily-readiness-day-index-restored-20260921`: an absent day-index dependency must not trigger an unchanged protected retry; a later natural upstream restoration can materially change the result. These learnings **do not** prove the cause of the newer red run.
- `fingerprintKey=research-governance.n2-natural-readiness-red-run-layer-evidence-uncertainty`
- `attemptSignature=read-only-compare-natural-readiness-run-job-step-and-decoded-log-evidence`
- `environmentKey=github-connector/self-hosted-macos-node24/read-only`
- `materialStateKey=main-readiness-v1/failed-evidence-step/latest-job-log-unavailable/older-log-missing-daily-plan`
- Gate: `PROCEED_DISTINCT / REUSE_GUARDRAIL`. Classification: `REUSED_LEARNING / NO_NEW_LEARNING`. No new causal root class or non-obvious verified engineering success was established; do not create a duplicate LEARN merely for an unavailable log.

## Decision and next safe action

Keep protected N2 dormant from this research workflow; do not dispatch or rerun it for diagnostics. If the exact missing job log later becomes retrievable through read-only GitHub access, first inspect the **entire** payload/process/post-job log and then check independent runner/platform evidence before assigning a new root cause. Otherwise wait for ordinary upstream evidence/authorized operator review, without inventing a current day-index state or readiness count. Continue independent K issuer-rights, exact-ticket return-kind, correction/finality and prospective-cohort evidence work on Draft PR #2286. **No merge, scoring, or production authority follows from this audit.**

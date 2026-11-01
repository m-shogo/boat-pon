# Forward Vault v0.2 — legacy manual request-reference log privacy audit (2026-11-01 JST)

**Disposition: NEW_FAILURE (conditional static privacy exposure) / ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only source review. No legacy workflow dispatch, self-hosted runner access, protected N2 activation, private raw T-5 evidence, secret, private filesystem path, Current BUY, LINE, public publishing, automated betting, production settings, or Owner Dashboard operation occurred.

## Question and source-pinned mechanism

**Question:** Can a free-form legacy manual dispatch reference reach an Actions log without a privacy-specific filter?

**Hypothesis:** Yes. An owner-supplied reference may satisfy the builder's character/length regex while containing path-like punctuation. The workflow echoes the complete request JSON before the strict request-validation step, so a path-like value could be printed to Actions logs if an operator supplied one.

Pinned canonical main `2342494f6581c167a5648681ca7374b26d6659d4`, Draft research PR #2286 pre-write HEAD `3fc5f2819a357267ceccff794ffd85fc2fb2a214`. Separate #2287 owns LINE work. The [legacy workflow](https://github.com/m-shogo/boat-pon/blob/2342494f6581c167a5648681ca7374b26d6659d4/.github/workflows/boat-pon-local-research.yml) blob `95094e7` declares `request_reference` as a free-form dispatch input, binds it as `REQUEST_REFERENCE`, runs the builder and then performs `cat data/tmp/automation/request.json` in the same step. The [builder](https://github.com/m-shogo/boat-pon/blob/2342494f6581c167a5648681ca7374b26d6659d4/scripts/build-research-request.mjs) blob `8fdf91c` accepts a nonempty reference with the lexical class `[0-9A-Za-z._:/# -]` (maximum 200 characters), copies it into the `requestReference` JSON property, and emits JSON to stdout. A slash/colon is accepted; no privacy-specific absolute-path or embedded-path rejection is performed on this field. The subsequent validation step occurs **after** the full-request echo.

**Scope limit:** This establishes only an input-to-log path in source code. The owner/main guard restricts who can dispatch; there is no evidence that a real path-like reference was ever supplied, that a workflow was enabled/running, that a private path was logged, or that any secret was leaked. The Draft's early-exit legacy `task` denial would not remove this earlier build/echo step after merge. Do not confuse a possible operator input with private evidence collected by the runner.

## Safe review and falsification

- Source-only trace: dispatch input → environment variable → builder lexical check → `requestReference` JSON → stdout/full JSON `cat` → Actions log, before request validation.
- No real or synthetic filesystem path string was passed to GitHub Actions, and no workflow was executed. The finding does not require reading private raw data.
- Reused [embedded-local-path proof-request Learning](https://github.com/m-shogo/boat-pon/blob/3fc5f2819a357267ceccff794ffd85fc2fb2a214/research/registries/learnings/LEARN-forward-v02-proof-request-embedded-local-path-id-20261031.json) as a privacy principle; this workflow **log sink** is a distinct root-cause boundary.
- The latest pre-write exact-head [CI #41251026812](https://github.com/m-shogo/boat-pon/actions/runs/41251026812) completed SUCCESS for Verify and Research Governance (4,698 PASS / 2 SKIP / 0 FAIL). Full job logs show typecheck/build, research governance, secret and production-isolation checks, and post-job cleanup passed. This CI did not exercise the legacy workflow, the free-form reference, or any log-redaction remediation.
- Falsification: an approved source change must remove full request echo or provably redact the reference **before any log sink**, with bounded synthetic reference cases and benign opaque IDs. A schema validator running after the echo is not sufficient.

## Operator decision, authority, and learning gate

The operations owner should separately decide whether to retire the legacy workflow, suppress full-request logging, and constrain reference IDs. This report does **not** authorize a workflow modification or restart of the deprecated CLI. Do not weaken the existing owner/main guard, independent retention CAS writer, post-run read-only audit, or canonical intent dispatch to remediate logging.

- `fingerprintKey=research-automation.legacy-manual-request.reference-raw-log-projection`
- `attemptSignature=pr2286-v509-pinned-main-builder-and-workflow-reference-projection-static-no-dispatch`
- `environmentKey=github-connector-pinned-main-static-source/no-dispatch`
- `materialStateKey=legacy-manual-workflow-95094e7/builder-8fdf91c/owner-dispatch-reference-log`
- Gate: `PROCEED_DISTINCT / REUSE_GUARDRAIL`; classification `NEW_FAILURE`. Durable append-only record: `LEARN-legacy-manual-request-reference-raw-log-projection-20261101`. No equivalent failed execution was retried.
- Historical `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` do not establish K-source issuer/rights, authenticated ticket-level settlement/corrections/finality, or a frozen prospective evaluation. The Rejection registry contains no substantive record.

**Decision:** Keep #2286 Draft and `ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE`; `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`. K rights, independent settlement/correction/finality evidence, frozen cohort, approved scoring protocol, and operational-owner legacy-workflow disposition remain unresolved.

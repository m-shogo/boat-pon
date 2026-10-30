# Forward Vault v0.2 — PR #2286 static module import and effect boundary review (2026-10-30 JST)

**Disposition: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** This is a bounded, read-only inspection of the **complete source text of the 27 changed non-test TypeScript modules** under `src/research/governance/`, with GitHub source reads pinned to PR head `61a54b5bc3327cbc05122e4d4db7b7908b92513e`. It supplements the previous [changed-path inventory](forward-v02-pr2286-research-scope-and-review-gate-20261030.md); it does **not** prove runtime isolation, absence of transitive side effects, safe execution, external source authority, merge readiness, or the full 679-commit history.

## Distinct review question and bounded method

The v468 audit established that the 365 changed paths lie within research/governance subtrees, but explicitly did not inspect imports. Can a reviewer now identify direct module dependency edges and the source files with side-effect capabilities **without running protected N2 or touching production**?

- Read all **27 changed non-test `.ts` modules** at the fixed PR head using GitHub file-content reads. The PR file inventory also includes **93 changed `.test.ts` files**, which were not comprehensively source-audited here.
- Extracted source-level static `import ... from`, `export ... from` and literal dynamic `import(...)` / `require(...)` specifiers, including multiline declarations. Classified direct dependencies as sibling research modules, Node built-ins or outside the research tree.
- Reviewed the write-capable [executor SDK](../../src/research/governance/executorSdk.ts) and its [write-scope boundary tests](../../src/research/governance/executorSdk.writeScopeBoundary.test.ts), plus the [Node child-environment helper](../../src/research/governance/researchNodeChildEnv.ts).
- Inspected the official [latest-head CI #41023426098](https://github.com/m-shogo/boat-pon/actions/runs/41023426098) verify and research-governance **full job logs**. No CI was re-run and no protected N2 job was activated.

## Observed static import boundary

| Item | Observed at pinned head | Meaning / limit |
| --- | --- | --- |
| Changed non-test TypeScript modules inspected | **27 / 27** | Complete source-text inspection of this bounded changed-module set, not the whole repository |
| Changed research tests in PR inventory | **93** | Their entire import/side-effect graphs were **not** exhaustively inspected |
| Direct static imports outside sibling research modules or Node built-ins | **0 observed** | No direct import of Current BUY, LINE, public publishing, Owner Dashboard or production module in these 27 files; does not prove reverse dependencies or runtime safety |
| Literal dynamic `import()` / `require()` calls | **0 observed** | Does not cover computed imports, eval-like execution, transitive dependencies or all tests |
| Node built-in module specifiers observed | `node:crypto`, `node:fs`, `node:path`, `node:util`, `node:util/types` | Built-in use is not automatically harmless; `node:fs` has write capability |
| Direct relative module specifiers | sibling `./...` research modules only | Static direct edges stay inside the inspected research-governance subtree |

The source imports include explicit research-only cross-ledger references: `forwardScoringAdmission.ts` imports the research Forward Vault, Runtime Decision Ledger and Outcome Learning Ledger; `forwardV02OutcomeLinkPreflight.ts` imports the two research ledgers and reconciliation helpers. The presence of `BUY`, `LINE` or notification-related **data fields** in research types/mappers is not itself a production execution edge. These modules must remain disconnected from production consumers and cannot authorize scoring from synthetic evidence.

## Effect-capable files and remaining review limits

1. **`executorSdk.ts` is write-capable.** It imports `node:fs` and exposes `atomicWriteUtf8` / `atomicWriteJson`, plus an executor lifecycle with `writeArtifacts`, `verifyArtifacts`, `recordEvidence` and `finalizeEvidence` callbacks. Its `checkWriteScope` rejects absolute paths, traversal substrings and sibling-prefix escapes; scope checks are performed on planned, written, evidence and final output path lists. Dry-run exits with `DRY_RUN_OK` before those callbacks, and the SDK documents queue-state transition ownership as external. **These are observed controls, not a proof that all callback effects or filesystem races are contained.** In particular, path-list checking does not sandbox arbitrary callback code, and directory preflight alone is not an atomic path-resolution guarantee.
2. **Node child environment helpers are environment-aware.** `researchNodeChildEnv.ts` and `forwardEvaluationVault.nodeChildEnv.ts` accept `process.env` as a default input; the former copies the environment and deletes `NODE_OPTIONS` before use by research child fixtures. This is a bounded preload isolation guard, **not** a general subprocess sandbox.
3. **No direct production import is not a full isolation proof.** This review does not resolve reverse import edges from unmodified files, bundler aliases, computed module resolution, runtime network/filesystem effects, 93 test modules or the historical commit-by-commit import graph. Keep CI production-isolation and secret-scan gates mandatory. The GitHub full-PR diff endpoint returned **HTTP 406 (over 300 changed files)**, so this review deliberately used paginated changed-filename inventory and individually pinned file reads rather than pretending to have inspected a complete diff.

## CI and external evidence authority

At the **pre-write** head `61a54b5bc3327cbc05122e4d4db7b7908b92513e`, [CI #41023426098](https://github.com/m-shogo/boat-pon/actions/runs/41023426098) concluded **SUCCESS**: verify **4,673 tests / 4,671 PASS / 2 SKIP / 0 FAIL**; research-governance **SUCCESS**. TypeScript/build, research governance, secret scan, production-isolation and replay checks passed. Both jobs' post-checkout and post-setup cleanup succeeded. Nonfatal Node.js 20 action, `punycode` and `url.parse` deprecation warnings remain. **This is the pre-report CI; it does not validate this report commit.**

No K-specific authorized publisher/rights, independently authenticated inclusive correction history, finality checkpoint, trusted time/key/revocation, exact ticket/refund settlement, independently frozen cohort or approved evaluation protocol was obtained. A synthetic digest or green CI cannot close those blockers. Existing [K-provider evidence request](forward-v02-provider-clarification-evidence-request-20261026.md), [source finality audit](forward-v02-source-finality-ordering-capability-audit-20261026.md) and [first-party issuer-role separation](forward-v02-K-issuer-role-separation-first-party-audit-20261028.md) remain the appropriate external-evidence authorities. No provider was contacted or K archive accessed.

## Learning gate and disposition

- Latest canonical `main` at pre-write gate: `2342494f6581c167a5648681ca7374b26d6659d4`. Research PR [#2286](https://github.com/m-shogo/boat-pon/pull/2286) **OPEN / Draft**, head `61a54b5bc3327cbc05122e4d4db7b7908b92513e`; other open [#2287](https://github.com/m-shogo/boat-pon/pull/2287) is a separate LINE lane and was not touched. Recent canonical merged research PRs [#2284](https://github.com/m-shogo/boat-pon/pull/2284) and [#2285](https://github.com/m-shogo/boat-pon/pull/2285) were checked.
- Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`, the relevant synthetic-reference guardrail `LEARN-forward-v02-synthetic-reference-never-authority-20261025`, existing external-authority reports, and `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2`. That historical exploration/coverage Discovery is not a source-finality proof or prospective freeze. Existing audits found no relevant substantive Rejection.
- `fingerprintKey=research-k3.forward-vault.pr2286-static-module-import-effect-boundary-review`
- `attemptSignature=pr2286-v469-all-27-changed-nontest-modules-static-import-specifier-and-effect-capability-audit`
- `environmentKey=github-connector/pinned-file-source-reads+official-actions-job-logs`
- `materialStateKey=pr2286-head-61a54b5-27-nontest-research-modules-93-tests-external-K-proof-unresolved`
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. This addresses a gap expressly left by v468; it is not a retry of K landing-page extraction, provider outreach, or already-resolved synthetic failure.
- Classification: **REUSED_LEARNING / NO_NEW_LEARNING**. A bounded static audit provides reviewer evidence but no new demonstrated root-cause failure or non-obvious verified reusable success; no filler `LEARN-*` record.
- Keep `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`; **DO_NOT_MERGE_CANDIDATE**. No protected N2 activation, Current BUY/LINE/public/automated betting/production/settings/Owner Dashboard changes, private raw T-5 odds, secrets, private paths or fabricated readiness counts.

**Next safe action:** independently review a *separately authorized K-specific issuer/rights and correction/finality evidence packet*, or, while awaiting it, conduct a **bounded reverse-import / test-side-effect audit** without changing production. Keep the research PR Draft.

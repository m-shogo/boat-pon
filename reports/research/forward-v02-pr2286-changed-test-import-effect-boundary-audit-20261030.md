# Forward Vault v0.2 — PR #2286 changed-test import and side-effect boundary audit (2026-10-30 JST)

**Disposition: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Bounded, read-only source inspection of **all 93 changed `src/research/governance/*.test.ts` files**, pinned to pre-write PR HEAD `08540e48dcd4ff4bd01a2be5bc4d6646a7ba32e8`. This closes the changed-test-source coverage gap in the [v469 module audit](forward-v02-pr2286-static-module-import-and-effect-boundary-20261030.md). It does not run protected N2, certify runtime isolation or authorize production.

## Research question and method

Can reviewers enumerate the changed tests' direct import boundaries and process/filesystem/global-mutation capabilities without activating production or private evidence?

- Used the GitHub paginated changed-file inventory, selected 93 changed `.test.ts` files under `src/research/governance/`, and fetched **93/93 complete UTF-8 source texts** from the fixed PR HEAD. No source read failed.
- Inspected `from "..."` and literal `import("...")` / `require("...")` specifiers and lexically counted recognized filesystem write/delete/rename/open, child-process, network, environment, temporary-directory, Python and global-patch tokens. This is **not** an AST or runtime trace and does not cover computed imports, bare side-effect imports or transitive dependencies.
- Read representative effect-capable source: `canonicalRequestSafeRead.test.ts`, `forwardEvaluationVault.concurrentPublication.test.ts`, `forwardEvaluationVault.persistence.test.ts`, `forwardEvaluationVault.renameNoReplaceLinux.test.ts`, `forwardEvaluationVault.scmRightsAdmissionLinux.test.ts`, `forwardEvaluationVault.processTermination.test.ts`, `forwardEvaluationVault.readbackPublicationWindow.test.ts`, `researchNodeChildEnv.execFile.test.ts`, `runtimeDecisionLedgerBoundedCommand.test.ts`, `runtimeDecisionLedgerShadowDateCli.test.ts`, and global-patch regression portions of `runtimeDecisionLedgerShadowEvidence.test.ts`.

## Findings (static lexical observations, not runtime safety claims)

| Item | Observed | Meaning and limit |
| --- | --- | --- |
| Changed test source fetched | **93 / 93** | Complete changed-test subset, not all repository tests |
| Direct `from`/literal import/require specifiers outside sibling research modules and Node built-ins | **0 observed** | No scanned direct Current BUY, LINE, public or Owner Dashboard import; not a reverse-import proof |
| Test files containing recognized filesystem write/delete/mkdir/rename/open/atomic-write call tokens | **29 / 93** | Potential effect capabilities; token matches do not establish writes to production |
| Test files containing recognized child-process call tokens | **28 / 93** | Node/Python synthetic subprocess capabilities; not evidence of sandboxing |

Observed Node built-ins include `node:fs`, `node:child_process`, `node:crypto`, `node:sqlite`, `node:test`, `node:os`, `node:path`, `node:url` and `node:assert/strict`. Research-only import paths do not make effectful tests harmless.

**Representative controls and remaining risk:** `runtimeDecisionLedgerBoundedCommand.test.ts` creates a **synthetic** SQLite database in an OS temporary directory, invokes the research shadow report with explicit fixture paths, verifies sanitized evidence and removes the directory in `finally`. Forward Vault persistence tests use disposable temporary roots with `afterEach` cleanup. Representative Node child fixtures use `isolatedResearchNodeChildEnv()` or `isolatedForwardVaultNodeChildEnv()` to strip inherited `NODE_OPTIONS`, but this is **not a general sandbox**. Linux SCM_RIGHTS probes use isolated Python `-I`, an optimization-mode assertion and descriptor cleanup; they remain synthetic OS tests. Representative global prototype/constructor monkeypatch tests restore originals in `finally`. No exhaustive semantic verification of all 28 subprocess cleanup/timeout paths, all 29 filesystem scopes, all global patches, unmodified reverse-import consumers or transitive side effects was performed.

The preceding 27-module audit found a write-capable `executorSdk.ts` with callback effects not sandboxed by path allowlists. Production-isolation and secret-scan CI gates remain mandatory but do not prove complete runtime non-interference.

## Canonical authority, CI and external blockers

At the pre-write gate: canonical `main=2342494f6581c167a5648681ca7374b26d6659d4`; [PR #2286](https://github.com/m-shogo/boat-pon/pull/2286) OPEN/Draft at `08540e48dcd4ff4bd01a2be5bc4d6646a7ba32e8`; other open [PR #2287](https://github.com/m-shogo/boat-pon/pull/2287) is a separate LINE lane and untouched. Scheduled research automation enabled. Main contracts `research-learning-loop.md` and `research-knowledge-retention-contract.md`, relevant LEARN records, `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2`, the main Rejection registry (only `.gitkeep`), and merged PRs #2284/#2285 were consulted.

Official pre-write [Actions #41030966622](https://github.com/m-shogo/boat-pon/actions/runs/41030966622) **SUCCESS**: verify **4,673 tests / 4,671 PASS / 2 SKIP / 0 FAIL**, TypeScript/build/replay, research governance, production-isolation, secret scan and post-job cleanup succeeded. Full verify and governance job logs were read. Node 20 action, `punycode` and `url.parse` deprecation warnings were nonfatal. This CI predates the present report commit.

No independently attributable K-specific issuer/rights grant, authenticated inclusive correction/finality chain, trusted time/key/revocation proof, exact settlement/refund semantics, independently frozen cohort or approved evaluation protocol was obtained. Retain `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`. No merge or promotion.

## Learning gate

- `fingerprintKey=research-k3.forward-vault.pr2286-changed-test-import-effect-boundary-audit`
- `attemptSignature=pr2286-v470-all-93-changed-tests-pinned-static-import-and-effect-token-inventory`
- `environmentKey=github-connector/pinned-pr-file-reads+official-actions-job-logs`
- `materialStateKey=pr2286-head-08540e48-93-changed-tests-27-changed-modules-K-authority-unresolved`
- Gate **PROCEED_DISTINCT / REUSE_GUARDRAIL**: fills the v469 test-audit gap; does not retry unchanged synthetic failures. Reused `LEARN-forward-v02-synthetic-reference-never-authority-20261025`, `LEARN-forward-vault-scm-python-optimize-assert-oracle-20261028`, `LEARN-forward-vault-rename-race-stdout-framing-20261027`, `LEARN-executor-sdk-write-scope-sibling-prefix-20261012`.
- Classification **REUSED_LEARNING / NO_NEW_LEARNING**: no new demonstrated root-cause failure or non-obvious verified reusable success; no filler `LEARN-*` entry.

**Next safe action:** review independent K issuer/rights and authenticated correction/finality evidence if available; otherwise audit unmodified reverse-import consumers or a narrowly selected subprocess timeout/cleanup boundary. Keep Draft; do not activate protected N2 or change Current BUY, LINE, public publishing, automated betting, production behavior/settings or Owner Dashboard. Do not expose secrets, private paths or private raw T-5 odds.

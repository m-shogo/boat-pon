# Forward Vault v0.2 — main entrypoint reverse-import slice audit (2026-10-30 JST)

**Disposition: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Read-only, bounded review of potential *reverse* dependencies from main application, operational entrypoints, and workflow definitions into the research-governance code affected by [PR #2286](https://github.com/m-shogo/boat-pon/pull/2286). This is not a whole-repository import graph, AST analysis, transitive dependency proof, runtime trace, protected N2 diagnostic, or production authorization.

## Question, hypothesis, method, and evidence boundary

**Question:** Do the selected canonical-main production/public entrypoints or workflow files explicitly import or reference `src/research/governance/` / `research/governance` code, undermining the prior changed-file-only isolation audit?

**Hypothesis:** The selected entrypoints have no direct textual dependency on research-governance modules, but a negative lexical finding cannot rule out indirect invocation, computed imports, scripts, or effectful callbacks.

**Pinned source:** canonical `main=2342494f6581c167a5648681ca7374b26d6659d4`; pre-write PR #2286 `30fa5b55f294df6c5512a3fa99e0d77178616755` (OPEN/Draft). All **23/23** selected source files were fetched by path from the pinned main SHA through the GitHub connector, without activating workflows or local/private data. No private evidence was read.

The review selected **all 13** main `.github/workflows/*.yml` definitions; **eight** operational/UI entrypoints (`scripts/notify-line.ts`, `scripts/publish-public-dashboard-snapshot.ts`, `server/candidates.ts`, `server/db.ts`, `server/index.ts`, `src/App.tsx`, `src/api.ts`, `src/main.tsx`); and **two** UI follow-up components (`src/components/ResearchLab.tsx`, `src/components/ResearchCommandCenter.tsx`). It inspected textual research/governance path markers, direct import-like references and relevant workflow commands. This is a deliberately limited risk-based slice, not an assertion about every unmodified file.

## Observations

| Boundary | Direct textual governance dependency observed? | Important caveat |
| --- | --- | --- |
| 13 canonical-main workflow YAML files | **No explicit `src/research/governance` path marker in selected source** | Workflows can launch scripts and downstream commands; absence of a module path string is not execution isolation. The N2 workflows were **not run** as part of this audit. |
| `scripts/notify-line.ts`, `scripts/publish-public-dashboard-snapshot.ts` | **No explicit governance import/path marker observed** | Imported modules, indirect calls, environment and runtime behavior were not fully traversed. |
| `server/candidates.ts`, `server/db.ts`, `server/index.ts` | **No explicit governance import/path marker observed** | This does not establish all server handlers or DB effects are independent. |
| `src/App.tsx`, `src/api.ts`, `src/main.tsx` | **No explicit governance import/path marker observed** | `src/App.tsx` imports `./components/ResearchLab`; the word “Research” alone is not a governance-module dependency. |
| `src/components/ResearchLab.tsx`, `src/components/ResearchCommandCenter.tsx` | **No explicit governance import/path marker observed** | ResearchLab imports `../api` and public snapshot hooks; ResearchCommandCenter imports public presentation snapshot types. These are not proof of absence of all transitive paths. |

The main CI workflow invokes `npm run research:governance-check` and has research boundary/secret scanning, but these gates are not a runtime non-interference proof. Several other workflow definitions have N2-related commands and must remain protected under their existing activation policy. A scheduled N2 workflow observed in GitHub Actions state was **not** activated, rerun, modified or interpreted as readiness evidence by this audit.

The prior [v469 module audit](forward-v02-pr2286-static-module-import-and-effect-boundary-20261030.md) covered 27 changed implementation modules, and [v470 changed-test audit](forward-v02-pr2286-changed-test-import-effect-boundary-audit-20261030.md) covered 93 changed test files. This v471 check fills a *bounded reverse-entrypoint visibility gap* without pretending to close the unmodified full-tree or transitive-graph gap. In particular, research `executorSdk.ts` retains write capabilities; a direct-import-negative finding does not establish that callbacks, CLI dispatch, or imported helpers cannot have side effects.

## Verification, falsification, and authority

- Pinned GitHub file reads: 23/23 selected paths returned source text. Main tree inventory listed 13 workflow definitions. No code/test execution, process launch, external authority verification or protected N2 activation was performed in this review.
- Pre-write official [Actions CI #41038537697](https://github.com/m-shogo/boat-pon/actions/runs/41038537697) on PR HEAD `30fa5b55`: **SUCCESS**; verify **4,673 tests / 4,671 PASS / 2 SKIP / 0 FAIL**, build/replay and research governance/production isolation/secret scan passed; post-job cleanup passed. Full verify and governance job logs were inspected. Nonfatal Node 20 / `punycode` / `url.parse` deprecation warnings remain. This CI **predates** the present report.
- Falsification path: use a scoped AST/import graph of unmodified main modules and script command dispatch, resolve path aliases and computed imports, and separately audit side-effectful child-process/file operations. Any reverse edge or effectful transitive path must be evaluated against the research/production isolation contract. Do not assert absence of all reverse imports from this 23-file sample.
- Canonical governance read: latest-main `docs/architecture/research-learning-loop.md`, `docs/architecture/research-knowledge-retention-contract.md`; `EXP-dataset-expand-701398c2`, `DISC-dataset-coverage-701398c2`, and empty main Rejection registry; merged PRs #2284/#2285. The dataset coverage discovery is **not** a K-source rights/finality proof and its historical quantities are not forward-readiness counts.
- K-specific issuer/rights grant, authenticated correction/finality chain, trusted time/revocation proof, exact payout/refund semantics, independently frozen cohort and approved evaluation protocol remain unverified. Preserve `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`. Do not merge, promote or connect to Current BUY, LINE, public publishing, automated betting, production settings or Owner Dashboard.

## Learning gate and next action

- `fingerprintKey=research-k3.forward-vault.pr2286-main-entrypoint-reverse-import-slice`
- `attemptSignature=pr2286-v471-main-pinned-13-workflows-8-entrypoints-2-ui-components-lexical-path-audit`
- `environmentKey=github-connector-pinned-main-file-reads+official-actions-job-logs`
- `materialStateKey=main-2342494f-pr2286-30fa5b55-23-entrypoint-files-K-authority-unresolved`
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**, not an unchanged synthetic retry. Reused `LEARN-executor-sdk-write-scope-sibling-prefix-20261012` (path-prefix matching is not containment) and `LEARN-forward-v02-synthetic-reference-never-authority-20261025` (synthetic comparison never grants external authority).
- Classification: **REUSED_LEARNING / NO_NEW_LEARNING**. No newly demonstrated root-cause failure or non-obvious verified reusable success; no filler `LEARN-*` record.

**Next safe action:** seek independently attributable K issuer/rights and authenticated correction/finality evidence first. While unavailable, perform a *narrowly scoped* transitive CLI dispatch or AST reverse-edge audit with pinned evidence, without running protected N2, exposing private data, or treating green CI as merge approval. PR stays Draft.

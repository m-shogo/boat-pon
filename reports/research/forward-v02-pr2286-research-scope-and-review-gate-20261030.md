# Forward Vault v0.2 — PR #2286 research scope and merge-review gate (2026-10-30 JST)

**Decision: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** This is a bounded, read-only review of the *GitHub changed-filename inventory and current evidence gate*, not a code-level safety proof, source-rights approval, independent K correction/finality attestation, readiness count, or production promotion.

## Distinct review question

The Draft research PR has accumulated a large amount of synthetic/governance work. Before more code is added, can reviewers independently confirm that its **file-path scope** remains segregated, identify the remaining non-code authorization dependency, and avoid conflating successful CI with merge permission? This audit does not repeat the previously failed K landing-page extraction, re-request provider evidence, execute a protected N2 attempt, or reopen already-fixed ambient JavaScript tests.

## GitHub authority snapshot (before this report commit)

- Canonical `main`: `2342494f6581c167a5648681ca7374b26d6659d4` (unchanged).
- Research PR [#2286](https://github.com/m-shogo/boat-pon/pull/2286): **OPEN / Draft**, head `2d4100ba6b921ab4ebe4f182c1c3935551d597cd`, 678 commits, 364 changed filenames, no merge.
- Other open PR [#2287](https://github.com/m-shogo/boat-pon/pull/2287): separate LINE readability / miss-review work, **not owned by this research lane**. No files, comments, state or workflows in that PR were changed.
- Latest merged canonical PRs: [#2284](https://github.com/m-shogo/boat-pon/pull/2284) (Forward Vault contract, merge `c64b893f0c86ab73707b163da3f835c461866ab3`) and [#2285](https://github.com/m-shogo/boat-pon/pull/2285) (Forward Vault core, merge `2342494f6581c167a5648681ca7374b26d6659d4`). These merges do not authorize the present Draft.
- PR head [CI #41017427022](https://github.com/m-shogo/boat-pon/actions/runs/41017427022) **SUCCESS**: verify 4,671 PASS / 2 SKIP / 0 FAIL; research-governance SUCCESS; TypeScript/build, production isolation, secret scan, replay and post-job cleanup SUCCESS. Full verify/governance job logs inspected. Nonfatal Node 20 action, punycode and url.parse deprecation warnings remain. **This is the previous-head CI; it must not be represented as CI for the new report commit.**

## Independent changed-path inventory

The GitHub PR changed-filename API returned **364 paths** before this report was added, partitioned without overlap:

| Top-level subtree | Changed paths | Boundary meaning |
| --- | ---: | --- |
| `config/research-governance/` | 5 | Research governance configuration |
| `reports/research/` | 62 | Research-only reports and review artifacts |
| `research/` | 177 | Research registry and research artifacts |
| `src/research/` | 120 | Research-only implementation and tests |
| **Total** | **364** | **No changed filename outside these four subtrees in this snapshot** |

This is a **path inventory only**. It does **not** prove that every source import, runtime dependency, executable effect or historical commit is safe; the dedicated production-isolation, secret-scan and research-governance checks remain mandatory. The new report itself adds one further `reports/research/` path after this snapshot. The PR is unusually large; passing CI is not a substitute for human review of scope, lineage and source authorization.

## Evidence gate: what remains external

The [source-finality capability audit](forward-v02-source-finality-ordering-capability-audit-20261026.md), [provider evidence-request packet](forward-v02-provider-clarification-evidence-request-20261026.md), and [first-party issuer-role separation audit](forward-v02-K-issuer-role-separation-first-party-audit-20261028.md) remain authoritative for the unresolved K-specific evidence request. In particular:

1. The [official download index](https://www.boatrace.jp/owpc/pc/extra/data/download.html) advertises downloadable race results but does not by itself grant automated collection/retention rights or authenticate source-issued correction order.
2. The [official boatrace.jp site policy](https://www.boatrace.jp/owpc/pc/extra/policy.html) identifies the operator of **boatrace.jp** and describes copyright/permissions, disclaimers and linked-site responsibility. The policy's **site scope is not an attributable K-host-specific license**, and it must neither be generalized to grant permission nor treated as conclusive proof that a separate K license cannot exist.
3. Organization-level descriptions separate general information-system and competition-judging responsibilities, but neither assigns a verified K-host publisher, revision-completeness checkpoint, finality policy, independent key/time/revocation trust or exact-ticket refund authority.
4. A local hash, a successful synthetic verifier, an observed FINAL flag, a website's current result or a third-party mirror cannot prove an authenticated **inclusive correction range** or the absence of a later correction. Historical `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2` inventory does not constitute prospective cohort freeze or a source attestation. No relevant substantive Rejection record was identified in the existing audit lineage.

**Actionable review order:** (a) obtain an independently attributable K issuer/rights and source correction/finality specification through a separately authorized human route; (b) review source-controlled range completeness, checkpoint, keys/clock/revocation and exact refund binding; (c) freeze the evaluation cohort/protocol independently; (d) only then consider a small, separately reviewed research promotion plan. Do not expand the Draft solely to simulate missing external proof.

## Learning and safety gate

Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`, relevant Forward Vault source-finality and source-reference-provenance Learning, Experiment/Discovery lineage and recent merged PRs. This is a **distinct PR review-scope inventory**, not a retry of an unchanged K landing-page extraction, provider-contact guess or synthetic verification claim.

- `fingerprintKey=research-k3.forward-vault.pr2286-research-path-scope-review`
- `attemptSignature=pr2286-v468-github-paginated-changed-filename-inventory-and-authority-gate-audit`
- `environmentKey=github-connector/pr-changed-path-inventory+official-public-docs-review`
- `materialStateKey=pr2286-head-2d4100ba-678-commits-364-research-paths-external-K-rights-and-finality-unresolved`
- Gate: **REUSE_GUARDRAIL / PROCEED_DISTINCT**. Reuse source-rights non-transitivity, source-reference provenance and synthetic-proof nonpromotion guardrails.
- Classification: **REUSED_LEARNING / NO_NEW_LEARNING**. The path audit adds a current reviewer checkpoint, not a new root-cause failure or non-obvious verified guardrail; **no filler LEARN record**.

**Isolation:** `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`. No N2 activation/attempt consumption, Current BUY, LINE, public publishing, automated betting, production settings/behavior, Owner Dashboard, private raw T-5 odds, secrets, private paths or provider contact. Keep PR #2286 Draft and main canonical.

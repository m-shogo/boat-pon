# Forward Vault v0.2 — research candidate money-population and special-payout guardrail (2026-10-31 JST)

**Disposition: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** This is a research-only, synthetic contract preflight, not an authenticated K feed, rights grant, actual ticket-level settlement mapping, scoring protocol approval, or production behavior change.

## Question and evidence

The prior [official TELEBOAT refund/reporting audit](forward-v02-pr2286-official-teleboat-refund-reporting-denominator-separation-20261031.md) established that consumer-facing return rate may include refunds and special payouts, while hit/race-count conventions use different populations. Official public references: [TELEBOAT results aggregation](https://www.boatrace.jp/owpc/pc/extra/tb/kinou/kekka.html) and [Naruto public result list](https://www.boatrace.jp/owpc/pc/race/resultlist?hd=20211217&jcd=14). Neither page authenticates exact-ticket K settlement or authorizes research reuse.

**Distinct engineering question:** Could the unapproved v0.2 candidate claim `candidateComplete=true` without naming which stake/payout population its ROI formula sums or how special payouts are excluded? At the prior candidate source blob `80f18ab1`, yes: `moneyPolicy` contained a formula and refund/void handling but no stake/return population or special-payout field, and the exclusion taxonomy lacked `SPECIAL_PAYOUT`. This is an under-specified *draft contract*, not evidence of a real scored refund or payout.

## Concrete research-only change

[Commit 72d9870c](https://github.com/m-shogo/boat-pon/commit/72d9870cf98e9718f9a4c88acd91f46d2f0013ab) updates only `src/research/governance/` source and six synthetic test fixtures. The candidate preflight now requires exact, provisional declarations:

- `stakePopulation=EVALUABLE_SETTLED_STAKE_ONLY` and `returnPopulation=EVALUABLE_SETTLED_PAYOUT_ONLY`; these explicitly reject the TELEBOAT gross purchase/refund-inclusive return display convention.
- `specialPayout=EXCLUDE_AND_COUNT`, plus a required `SPECIAL_PAYOUT` exclusion reason. This is a **draft non-scoring policy choice**, not independently validated source semantics.
- A synthetic negative regression rejects consumer-display aliases, omitted policy fields, and a missing special-payout exclusion. Existing synthetic callers were updated to the expanded candidate shape. `scoringAuthorized=false` remains invariant.

The candidate does **not** compute ROI, reconcile ticket payouts, prove independent finality, freeze a prospective cohort, or authorize a scoring branch. Upstream Outcome Ledger evaluability and the frozen protocol remain mandatory separate gates.

## Official CI and failure-layer triage

Initial [Actions #41153670179](https://github.com/m-shogo/boat-pon/actions/runs/41153670179) was **red**: the intended synthetic test ran, but two assertions still expected pre-change diagnostics/counts. A missing money-policy field correctly returned `UNFROZEN_MONEY_OR_OUTCOME_POLICY` rather than the fixture's `INVALID_CANDIDATE_SHAPE`; the expanded exclusion list left eight rather than seven entries after one removal. This was **test expectation drift**, not an observed authorization bypass. Test process exited 1; verify job/workflow failed, research-governance succeeded, post-job cleanup succeeded, and no separate runner/platform fault was evidenced. Full job logs were inspected; unchanged failure was not rerun.

[Fixture correction 258d2722](https://github.com/m-shogo/boat-pon/commit/258d27224ab94c038c5182f1fc73077667e102af) updates only those two assertions. [Actions #41153953533](https://github.com/m-shogo/boat-pon/actions/runs/41153953533) on **exact code HEAD `258d2722`** completed **SUCCESS: 4,677 PASS / 2 SKIP / 0 FAIL (4,679 total)**. The new gross-return denial and strict Proxy exclusion tests executed; verify, TypeScript/build, research-governance registry/digest/retry gate, isolation, secret scan and post-job cleanup passed. Nonfatal Node 20 action-deprecation warnings remain. This CI predates this report/LEARN commit and does not establish K readiness.

## Learning gate, lineage and authority

- Latest-main contracts read: `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`. Prior merged Forward Vault contract/core PRs #2284/#2285, historical EXP/DISC dataset coverage and the Rejection inventory were reviewed; historical dataset claims do not establish current K authority.
- Reused `LEARN-forward-vault-refund-evaluability-contract-drift-20261018`, `LEARN-forward-vault-unresolved-vs-refund-policy-20261019`, and `LEARN-forward-v02-excluded-settlement-evaluability-20261024`. The intermediate assertion drift follows the known earlier-test-expectation guardrail; no duplicate failure Learning was created.
- `fingerprintKey=research-k3.forward-v02.candidate-consumer-return-metric-policy-ambiguity`; `attemptSignature=pr2286-v486-require-evaluable-stake-return-populations-and-special-payout-exclusion`; `environmentKey=github-actions-ubuntu26-node24-synthetic/connector-pr2286`; `materialStateKey=forwardEvaluationProtocolV02Candidate.ts@80f18ab1/money-policy-omits-populations-and-special-payout`. Gate `PROCEED_DISTINCT / REUSE_GUARDRAIL`.
- Classification `VERIFIED_SUCCESS`; append-only `LEARN-forward-v02-candidate-return-population-special-payout-20261031`, canonical-v2 digest `2e01426197bc0fc7872ca7ed9f69ba521069bb165ac6b7df701574a6e8d19fae`.
- Canonical main `2342494f6581c167a5648681ca7374b26d6659d4` remains authoritative; PR #2286 is Draft and unmerged. PR #2287 belongs to a separate LINE owner, with no changed-file overlap at pre-write audit.

**Next safe action:** independently source-authenticate K issuer/usage rights, complete correction/finality and exact-ticket market/refund/special-payout rules, then seek a separately reviewed prospective frozen v0.2 evaluation protocol. Until then, keep this provisional contract Draft and `ENGINEERING_REQUIRED`. No protected N2 activation/diagnostic dispatch, Current BUY, LINE, public publishing, automated betting, production settings/behavior, Owner Dashboard, private raw odds, secrets or private paths were accessed or modified.

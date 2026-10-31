# Forward Vault v0.2 — special-payout provenance at the Outcome Ledger bridge (2026-10-31 JST)

**Disposition: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only, read-only cross-contract audit. No K-source ingestion, raw odds, ticket/account access, protected N2 dispatch, scoring, production mutation, or new evaluation authorization.

## Distinct question

The v486 draft protocol now requires `specialPayout=EXCLUDE_AND_COUNT` and the `SPECIAL_PAYOUT` exclusion reason. **Can a future Outcome Learning Ledger → Forward Vault adapter distinguish a source-authenticated special payout from an ordinary terminal settled payout, without a caller inventing a label?** The currently inspected 0.1 record contract does not provide such an explicit classification field. This is a *future integration contract gap*, not evidence that an existing production adapter has mis-scored a special payout.

## Pinned source trace (PR #2286 HEAD `7d7a39320b63`)

| Boundary | Observed code contract | Consequence |
| --- | --- | --- |
| Outcome Ledger 0.1 type and validator | `OutcomeDisposition = SETTLED | REFUNDED | VOID`; `SETTLED` requires `FINAL`, `refundYen=0`, and `refundReason=null`. A `SETTLED` record has `payoutYen` and `evaluable` but no independent `specialPayout` or return-kind field. Source blob `cb9dda89a17f`. | The 0.1 schema alone cannot prove whether a positive non-refund return is ordinary payout versus 特払い. It must not be treated as a complete v0.2 settlement taxonomy. |
| Outcome Ledger JSON schema | `disposition` enum is likewise `SETTLED/REFUNDED/VOID`, with no special-payout field. Blob `2232959c94a4`. | Type and schema agree on the limited 0.1 vocabulary; changing meaning in place would reinterpret existing digests. |
| v0.2 outcome-link preflight | A terminal record is *not flagged as excluded* when `finality=FINAL`, `disposition=SETTLED`, `evaluable=true`; it still returns `scoringAuthorized=false`. Blob `e015cef94fc2`. | Internal identity/digest linkage and a caller-supplied evaluable flag do not establish return-kind provenance. No actual scoring bypass is demonstrated. |
| v0.2 authority metadata | Synthetic settlement vocabulary includes `SETTLED/REFUNDED/VOID/CANCELLED/UNRESOLVED`, and requires `SETTLED` iff `evaluable`. Blob `0267999b447c`. | There is no separate special-payout terminal class here either; future source mapping must not silently coerce it to an ordinary evaluable `SETTLED`. |
| v0.2 candidate protocol | Requires evaluable settled stake/payout populations and `specialPayout=EXCLUDE_AND_COUNT` plus `SPECIAL_PAYOUT`; still `UNAPPROVED`, `scoringAuthorized=false`. Blob `a48a733f7438`. | The exclusion policy is explicit but the upstream source-to-exclusion proof is not implemented. A policy string alone is not an authenticated classifier. |

The official public [TELEBOAT aggregation explanation](https://www.boatrace.jp/owpc/pc/extra/tb/kinou/kekka.html) distinguishes ordinary payouts, refunds and 特払い in consumer return-rate reporting. That page does **not** authenticate any particular ticket's terminal classification, revisions, source rights or settlement finality. The previous [v485 audit](forward-v02-pr2286-official-teleboat-refund-reporting-denominator-separation-20261031.md) documents this presentation/evaluation distinction.

## Fail-closed future bridge requirement

1. **No implicit coercion:** a future bridge must not infer ordinary `SETTLED/evaluable=true` merely from `FINAL`, `refundYen=0`, `payoutYen` or a race-level result. The exact ticket + bet type + selection + terminal revision and source-issued return kind must be independently attributable.
2. **Versioned semantics:** if source-authoritative special payout is to be represented, design a separately versioned outcome classification/adapter contract and digest, rather than silently extending the meaning of Outcome Ledger 0.1 `SETTLED` or rewriting existing records.
3. **Unresolved remains excluded:** when the source cannot prove ordinary versus special payout, preserve sanitized uncertainty and exclusion counts; do not convert the row to a win, loss or zero-return score. Maintain `SPECIAL_PAYOUT` as an explicit v0.2 exclusion once independently classified.
4. **Synthetic-only negative cases before any future adapter:** (a) final positive-return record without source return-kind evidence must not become scored; (b) authenticated special payout must be excluded and counted, not scored as a hit; (c) ordinary final settlement must remain distinct; (d) same race with different bet-type establishment statuses must not inherit one race-wide disposition. These are *proposed* fixtures, not tests claimed to have run.
5. **Independent gates still required:** issuer and usage rights, authenticated complete correction/finality chain, independent clock/witness/revocation, exact ticket settlement, frozen prospective cohort, and separately approved metric formula remain unverified. No readiness counts or score are inferred.

## Learning and authority gate

- Read canonical main `2342494f6581c167a5648681ca7374b26d6659d4`, latest-main learning-loop and knowledge-retention contracts, Forward Vault and Outcome Ledger architecture, merged #2284/#2285, and historical `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2`. Historical coverage does not prove K-source authority; no relevant Rejection lineage was established.
- Reuse `LEARN-forward-vault-refund-evaluability-contract-drift-20261018`, `LEARN-forward-vault-unresolved-vs-refund-policy-20261019`, `LEARN-forward-v02-excluded-settlement-evaluability-20261024`, and `LEARN-forward-v02-candidate-return-population-special-payout-20261031`. Their guardrails already forbid turning under-specified settlement classes into scored ROI. This is a distinct static bridge inventory, not a repeated failed execution.
- `fingerprintKey=research-k3.forward-v02.special-payout-upstream-disposition-provenance-gap`
- `attemptSignature=pr2286-v487-read-only-cross-ledger-special-payout-classification-matrix`
- `environmentKey=github-pinned-pr-source/read-only-official-ci`
- `materialStateKey=outcome-ledger-0.1-disposition-enum-cb9dda89+v02-candidate-special-exclusion-a48a733f+outcome-link-e015cef9`
- Gate: `PROCEED_DISTINCT / REUSE_GUARDRAIL`. Classification: `REUSED_LEARNING / NO_NEW_LEARNING`; no newly executed failure, scored result or non-obvious implementation success warrants a duplicate LEARN.

**Pre-write state:** main `2342494f6581` unchanged; PR #2286 OPEN/Draft at `7d7a39320b63`, 716 commits/391 changed files; PR #2287 is separate LINE ownership with zero file overlap in the preceding changed-file audit. [Exact pre-write HEAD CI #41154331077](https://github.com/m-shogo/boat-pon/actions/runs/41154331077) **SUCCESS**, 4,677 PASS / 2 SKIP / 0 FAIL; both verify and research-governance job logs and post-job cleanup inspected. This CI predates this report and does not verify any future adapter.

**Isolation and next step:** keep the PR Draft and `ENGINEERING_REQUIRED`; obtain independently attributable exact-ticket return-kind and correction/finality semantics before designing a versioned synthetic-only bridge. No Current BUY, LINE, public publishing, automated betting, production behavior/settings, Owner Dashboard, protected N2, private raw odds or private paths were accessed or changed.

# Forward Vault v0.2 — untrusted authority identity replay gate (2026-10-24)

**Status: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** This is an isolated research-only, deny-only cross-envelope metadata preflight. No independently authenticated witness, source, clock, trust anchor, payout, approved scoring protocol, real ROI, production behavior, Current BUY, LINE, public publishing, Owner Dashboard, or protected N2 activation is involved.

## Question, evidence, and decision

Question: can individually well-formed but caller-supplied prospective witness receipts and terminal source revisions be reused across different synthetic cohort/outcome envelopes without any cross-record contradiction signal?

At the start of this slice, canonical main was `2342494f6581c167a5648681ca7374b26d6659d4`; the sole open research PR was #2286 at `d986f62846c5b07c65efa32d02d2d5a999bdcb83`. The v290 `assessForwardV02AuthorityMetadata` preflight validated **one** envelope at a time. It could not compare the same issuer/receipt or source/revision identity across two individually valid envelopes. This is a synthetic cross-record coverage gap, **not** evidence that a real source or production path was compromised.

Authority consulted: latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`, v286 independent authority evidence contract, v287/v290 authority metadata preflight, `LEARN-forward-v02-excluded-settlement-evaluability-20261024`, `LEARN-forward-v02-predecision-settlement-revision-20261024`, and `LEARN-outcome-ledger-array-iterator-admission-bypass-20261021`. The canonical-main `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` concern dataset inventory, not independently attested forward evidence; no relevant canonical-main Rejection was found.

## Concrete implementation

- `src/research/governance/forwardV02AuthorityBatch.ts`: isolated batch preflight over **individually valid** v0.2 untrusted metadata envelopes. Dense own-data array admission; indexed iteration rather than mutable Array.prototype iterators.
- An issuer-scoped `receiptId` may repeat only with an identical cohort, protocol/membership digests, exact expected/included/excluded partition, first-decision time and witness commitment. Changed reuse returns `RECEIPT_REPLAY_CONFLICT`.
- A source-scoped `revisionId` may repeat only for an identical decision/ticket, disposition/evaluability and revision content/ordering. Changed reuse returns `SOURCE_REVISION_REPLAY_CONFLICT`.
- Exact repeats are idempotent; separate issuer/source namespaces are not conflated. Invalid envelopes and malformed batches fail closed.
- **All** paths return literal `independentAuthorityVerified: false` and `scoringAuthorized: false`. Even a clean batch is merely internally consistent caller metadata; changing a caller-selected issuer/source namespace can evade these local collisions, and no signature, source authority, timestamp, revocation, or universe completeness is independently verified.

## Synthetic verification

`src/research/governance/forwardV02AuthorityBatch.test.ts` adds **10 synthetic tests**: idempotent repeat, legitimate shared cohort receipt with different outcome revisions, cross-cohort receipt reuse, membership partition swap, changed revision digest, revision identity replay across decisions, distinct issuer/source namespace, invalid individual envelope, sparse/accessor/extra-property batch, and empty/non-array batch.

Commits:
- `68bc653acb60e968e9aec9f7f2f223cbe02f1d45`: preflight;
- `e0355a5ea2c78d0b86ffbee264d4c12eeb4e90e5`: 10 regression tests;
- `baaccc8dae0d03bf9461b5279ce2c6a5b6953c13`: append-only Learning.

Official latest-HEAD CI: [Actions #40072737192](https://github.com/m-shogo/boat-pon/actions/runs/40072737192), `verify` SUCCESS and `research-governance` SUCCESS; **4,312 PASS / 2 SKIP / 0 FAIL** (4,314 tests). The verify job log confirms the new replay tests executed. Green CI verifies synthetic structural guards only; it is not independent attestation, evaluation readiness, or merge permission.

## Existing red N2 workflows — layered interpretation

Natural Feature Rollup #40003695814: complete job log shows research payload `NO_CHANGE`, process step SUCCESS, post-job cleanup SUCCESS, but job conclusion FAILURE. Runner/platform root cause is not established. Daily Readiness #39834565537: payload reported `DAILY_PLAN_MISSING`, process exited 3 and job failed. Daily Readiness #40005501493: job failure, full log unavailable; no payload conclusion inferred. Feature Rollup #40050991961 remained QUEUED at inspection. No protected N2 workflow was triggered or rerun for diagnostics.

## Learning and promotion boundary

Classification: **NEW_FAILURE**, confined to an unmerged synthetic preflight's cross-envelope coverage. Durable `LEARN-forward-v02-cross-envelope-authority-id-replay-20261024`, digest `4089e3ecf17b75bcc35b9832423c912958e4fe502378624a4cecb42e8e248ce7`.

- `fingerprintKey`: `research-k3.forward-vault.v02-cross-envelope-authority-id-replay`
- `attemptSignature`: `pr2286-v291-synthetic-issuer-receipt-and-source-revision-replay-conflict-preflight`
- `environmentKey`: `github-connector/research-pr-node24-ci`
- `materialStateKey`: `forwardV02AuthorityMetadata.0.1-untrusted/pr2286-d986f628/single-envelope-only-no-cross-record-replay`
- Gate: `PROCEED_DISTINCT_SYNTHETIC_REPLAY_PREFLIGHT`; no unchanged matching failure; reuse prior deny-only, idempotency, and iterator-independent validation guardrails.

**Remaining blockers:** a reviewed externally provisioned trust-anchor and witness verifier, canonical prospective eligible-universe proof, independently authenticated terminal settlement and complete source-specific revision/supersession ordering, and approved v0.2 formula/denominator/refund/max-hit/exclusion contract. The next safe action is a versioned independent proof-verifier/trust-anchor API **specification and offline negative contract tests**; do not add an ALLOW branch, connect production, or merge PR #2286 based on synthetic CI.

# Forward Vault v0.2 — independent verifier offline negative fixture contract (2026-10-26)

**Decision: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** This is a research-only **specification** and machine-readable **negative fixture catalog**, not an implemented verifier, executed vector suite, trusted evidence, protocol approval, or scoring authorization. The companion JSON is `reports/research/forward-v02-independent-verifier-negative-vectors-20261026.json`. No private raw evidence, odds, secrets, private paths, production behavior, or protected N2 execution is involved.

## Question and bounded authority

What is the smallest **offline, independently provisioned** test harness that could falsify a future witness/settlement verifier without laundering the existing caller-supplied v0.2 request into trust?

Canonical main at the start of this slice: `2342494f6581c167a5648681ca7374b26d6659d4`; sole open research PR #2286, preceding head `08f69720dc2cab97b125c0e2452b115333968d53`. Latest-main research learning/retention contracts, PR #2285, the existing independent-authority contract, request/response handoff, prior LEARN records, and dataset Experiment/Discovery were reviewed. The dataset inventory does not attest prospective membership or final settlement. The Rejection registry contains no substantive entry relevant to this contract.

The current `buildForwardV02IndependentProofRequest` emits a detached **untrusted** request; `assessForwardV02UntrustedVerifierResponse` compares a caller-provided response, including a full request transcript digest. Neither authenticates a witness, a source, a clock or correction completeness. The existing `StrictNodeIngress` wrappers are opt-in Proxy rejection, **not** evidence verification. No new verifier implementation, wrapper, response status, scoring path, or production connection is introduced.

## Three custody planes — the central test condition

| Plane | Who controls it | Permitted contents | Forbidden inference |
| --- | --- | --- | --- |
| A. Caller metadata | Synthetic test author / future untrusted caller | Current allowlisted request fields: cohort/protocol/membership claims, claimed witness receipt/clock, claimed source revision chain and proof reference digests | Matching SHA-256, self-reported `VERIFIED`, `FINAL`, `EXACT`, `REVIEWED`, or issuer names **never** authorize evidence |
| B. Independently provisioned test policy | Separate fixture setup under future verifier tests | Synthetic **public** trust anchor reference, issuer/source allowlist, signature/inclusion algorithm, clock ordering tolerance, revocation snapshot freshness, source-specific revision ordering and terminality policy | Caller request cannot select or modify this plane; no real private keys, source credentials or operational policy committed |
| C. Independently authenticated test observations | Future isolated fixture adapter, not the caller response | Synthetic signed receipt and log inclusion, independent decision-time anchor, complete eligible-universe commitment, source-authenticated revisions and correction/supersession ordering | `createdAt`/local `observedAt`/caller `sequence` alone cannot establish the witness order or terminal result |

The future harness must construct A and B/C **separately**. Negative tests must mutate one plane while holding the other plane fixed. Otherwise a caller can regenerate matching digests/signatures under a self-selected key and a test may pass for the wrong reason. Positive verification is a **separate reviewed milestone** and is not present here.

## Machine-readable deny corpus

The JSON freezes **18 named negative cases** with lane, mutation, independent-fixture precondition, expected denial class and literal `expectedIndependentAuthorityVerified=false` / `expectedScoringAuthorized=false`. No actual signature, receipt, source record, key or private payout is stored.

- **W01–W07, witness:** caller self-signing; unapproved issuer; missing append-only inclusion; witness time equal to first decision; omitted eligible member; stale/missing revocation; independently signed receipt binding a different protocol digest.
- **S01–S09, settlement:** caller `FINAL/EXACT` without source attestation; missing predecessor; fork; source-scoped revision equivocation; unauthenticated latest terminality; terminal tie without trusted total order; ticket/decision mismatch; refund/void mislabeled evaluable; predecessor outside trust-anchor validity despite a valid terminal revision.
- **X01–X02, conjunction:** internally consistent but unauthenticated two-lane claims; matching **unattested test-only proof shapes** with an unapproved evaluation protocol. Both remain unscorable. **X02 must first deny as `UNVERIFIED_WITNESS`** because its test-only proof shapes are explicitly unattested; `UNAPPROVED_PROTOCOL` is an additional downstream blocker, not the first causal denial.

Expected denial codes are **proposed future verifier classifications**, not claims that the current implementation emits them. They reuse the outcome vocabulary of `forward-v02-independent-authority-evidence-contract-20261024.md` where applicable; `UNAPPROVED_PROTOCOL` is the existing admission blocker, not a new external attestation result. The stated precedence (authenticity before protocol approval) applies even when multiple blockers coexist. X02 deliberately contains both missing independent attestation and missing protocol approval, so the expected **first** denial is `UNVERIFIED_WITNESS`; the protocol blocker must still be retained separately. Other cases isolate one primary mutation.

## Required execution sequence (future work, NOT run)

1. Provision a versioned, non-production public test trust policy **outside the caller request**; keep private signing material out of Git and Actions logs. Pin issuer, algorithm, key validity/revocation, clock, log inclusion, source finality and ordering semantics.
2. Create a single fully synthetic base request through the current strict metadata builder. The base request is *not* a verified positive control. Keep its terminal proof reference synchronized with the final revision (reuse `LEARN-forward-v02-terminal-proof-ref-fixture-drift-20261024`).
3. Independently generate synthetic receipts/source revisions and their expected public verification metadata; never let the caller request manufacture the trust policy or the source's correction chain. Mutate one vector per case, preserving all other control-plane inputs.
4. Assert the **first causal denial** and the two literal false authorization fields for every case. Verify missing predecessors, forks and source order using the **entire** authenticated revision history, not only the latest observation.
5. Only after a separately reviewed positive cryptographic/inclusion/finality control exists, test that denial cannot be bypassed by a caller-recomputed request-binding digest or a signed but unauthorized issuer. No code path may connect these fixtures to Current BUY, LINE, publishing or scoring.
6. If the source cannot prove terminal correction completeness or the witness cannot prove a predecision eligible universe, report **ENGINEERING_REQUIRED**, not a guessed count, accepted ROI or readiness.

Falsifiers: a case returning `scoringAuthorized=true`; any caller-selected trust anchor becoming policy; an after-decision witness passing because of caller time; a missing correction predecessor being treated as terminal; a refunded/void outcome becoming an ROI loss; a test that reports an independently verified result without independently provisioned evidence.

## Learning gate and result

- `fingerprintKey=research-k3.forward-vault.v02-independent-verifier-negative-fixture-contract`
- `attemptSignature=pr2286-v346-18-offline-witness-settlement-negative-vector-specification`
- `environmentKey=github-connector/github-actions-node24-typescript6.0.3`
- `materialStateKey=forward-v02-pr2286-v345-untrusted-proof-request-response-no-external-verifier`
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. Reused `LEARN-forward-v02-partial-verifier-request-binding-20261024`, `LEARN-forward-v02-terminal-proof-ref-fixture-drift-20261024`, `LEARN-forward-v02-settlement-revision-anchor-window-20261024`, and `LEARN-forward-v02-node-proxy-rejecting-ingress-20261025`. No repeat of the failed two-phase snapshot method; no new failure or independently verified non-obvious success requiring a new LEARN.
- Classification: **REUSED_LEARNING**. This is a more executable **specification** of previously known independent-authority gaps, not proof that they are resolved. No new LEARN record.

## Verification and blockers

At initial creation, the JSON was read back from the PR branch: 18 unique case IDs, all denial-only with both authorization flags false, `productionConnection=false`. Official PR CI is **not** yet verified for this change; record its run/conclusion separately rather than copying the previous green status. Existing prior-head CI #40243284925 succeeded (verify 4,504 PASS / 2 SKIP / 0 FAIL; governance SUCCESS).

Read-only red-workflow separation: natural N2 Daily Readiness #40218434947 had payload `DAILY_PLAN_MISSING`, process exit 3 and workflow FAILURE with checkout cleanup completed; prior v332 PR CI #40191810250 failed three research tests, process exit 1, governance green, cleanup completed. Full job logs were inspected; neither failure proves a runner outage. No diagnostic N2 activation/retry was performed.

**Still missing:** independently provisioned witness/clock/revocation and source-finality trust policy, authenticated complete correction history, independently frozen prospective membership, formula/source attestation and approved v0.2 evaluation protocol. No scoring, merge, production or Owner Dashboard authority follows from this contract.

**Next safe step:** separately review the source-specific finality/ordering policy and choose a public, test-only trust-root/inclusion proof format before writing an executable offline verifier harness. Do not invent a trusted provider or fabricate a positive vector.

## v347 precedence correction and executable catalog guard (2026-10-26)

The original X02 specification contradicted its own first-causal-denial ordering: it expected `UNAPPROVED_PROTOCOL` even though its proof shapes were expressly **not independently attested**, while the catalog mandates trust/proof authenticity before protocol approval. X02 now expects `UNVERIFIED_WITNESS`, with protocol approval still separately blocked. This corrects **fixture expectations only**, not verifier behavior or readiness. `src/research/governance/forwardV02IndependentVerifierNegativeCatalog.test.ts` is an executable **static contract guard** (18-case identity, denial precedence, false authorization, duplicate/drift mutations), **not** execution of the 18 cryptographic/source verification vectors. No positive verifier, trust root, real source, scoring or production connection is introduced.

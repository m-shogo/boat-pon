# Forward Vault v0.2 — independent proof-request ticket-return-kind capability gap (2026-10-31 JST)

**Disposition: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only, synthetic negative-contract audit on Draft PR #2286. No K-data ingestion, real ticket/odds inspection, independent verification, scoring, protected N2 activation, or production connection.

## Question and result

Does a structurally consistent `forward-v02-independent-proof-request.0.1-untrusted` handoff prove the newly required `evidenceRequirements.terminalReturnKind=INDEPENDENT_EXACT_TICKET_TYPE_SELECTION_REVISION_AND_RETURN_KIND`? **No.** These are separate authority boundaries. The existing proof request intentionally exports source/anchor/terminal revision references and the complete claimed revision chain, but not ticket type, selection, ticket key or source-authenticated ordinary-versus-special return kind. Its `metadataConsistent=true` is not ticket-level return-kind attestation. The v0.2 candidate's exact evidence-requirement string is likewise only a declaration, not a verifier.

This is a **handoff capability mismatch to resolve before future verifier integration**, not a demonstrated current scoring bypass. All inspected paths retain `independentAuthorityVerified=false` and `scoringAuthorized=false`. Do not weaken the privacy allowlist to include raw ticket/odds/settlement values in Git or public request logs.

## Pinned evidence and synthetic regression

- Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`. Research Draft PR #2286 pre-write HEAD `8ff9d0b4a2259fec7e54672e80889691affeb449`; separate PR #2287 is LINE-owned.
- `src/research/governance/forwardEvaluationProtocolV02Candidate.ts`: the candidate requires independent exact ticket type, selection, terminal revision and return kind, with `SPECIAL_PAYOUT` excluded and counted, but always `scoringAuthorized=false`.
- `src/research/governance/forwardV02IndependentProofRequest.ts`: settlement request contains `sourceId`, `claimedAnchorId`, `terminalRevisionId`, `settlementProofDigest` and revision metadata, not ticket-level identity or return-kind proof. The request remains untrusted, not a verifier.
- `src/research/governance/forwardV02IndependentProofRequest.test.ts`: new synthetic regression `metadata-only settlement proof request cannot claim ticket-level return-kind coverage` asserts a consistent request remains unverified/unscorable and does not silently carry ticket identity, return-kind or special-payout classifier fields. Test commit `a449431e5c995383c9416a386cfe84dd2ff038a5`; **official exact-HEAD CI verification was pending when this report was prepared**.
- Prior reports: `forward-v02-pr2286-special-payout-outcome-ledger-bridge-gap-20261031.md`, `forward-v02-pr2286-ticket-return-kind-evidence-preflight-20261031.md`, and `forward-v02-independent-proof-request-handoff-20261024.md`. The first identifies the upstream 0.1 Outcome Ledger classification gap; this audit isolates the *separate future proof-request/verifier handoff*.
- Historical `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2` establish dataset inventory lineage, not K issuer rights or exact-ticket settlement authority. No Rejection records exist in latest-main `research/registries/rejections/`.

## Future verifier gate (design only; no adapter authorized)

1. An independently provisioned verifier must bind a source-issued, versioned terminal return-kind proof to **the exact ticket type, selection, decision identity and terminal revision**, with a source-specific correction/finality chain. A caller's `SETTLED`, positive payout, race-wide status or candidate declaration is insufficient.
2. Prefer a separately reviewed, privacy-preserving digest/commitment linkage and independent source-side verification over placing raw ticket/odds/private path data in the metadata-only request. A digest alone is **not** an attestation unless the independent issuer binds it to canonical ticket identity, source authority, revision and return kind.
3. Define a separately versioned proof-response contract and synthetic negative vectors for missing ticket binding, wrong bet type/selection, ordinary-versus-special ambiguity, source correction, race-wide inference and revoked authority. Do not reinterpret Outcome Ledger 0.1 or rewrite historical digests.
4. Until independently attributable issuer rights, authenticated complete correction/finality, ticket-level return-kind evidence, prospective cohort freeze and approved protocol exist, **no readiness count, ROI score, merge authorization or production promotion may be inferred**.

## Learning gate and limits

- `fingerprintKey=research-k3.forward-v02.proof-request-ticket-return-kind-capability-gap`
- `attemptSignature=pr2286-v489-cross-contract-untrusted-proof-request-negative-capability-regression`
- `environmentKey=github-connector-pinned-research-pr/github-actions-node24-synthetic`
- `materialStateKey=proof-request-0.1-untrusted-allowlist+v02-candidate-terminal-return-kind-required@8ff9d0b4`
- Gate: `PROCEED_DISTINCT / REUSE_GUARDRAIL`. Reused `LEARN-forward-v02-terminal-return-kind-fixture-parity-20261031`, `LEARN-forward-v02-candidate-return-population-special-payout-20261031` and the earlier independent-proof-request guardrails. This is a distinct cross-contract audit, not a retry of a failed N2 method.
- Classification at report creation: `REUSED_LEARNING / NO_NEW_LEARNING`. No new root-cause failure or non-obvious verified success is claimed before official CI; no duplicate LEARN record created.

**Isolation:** No Current BUY, LINE, public publishing, automated betting, production behavior/settings, Owner Dashboard, protected N2, private raw T-5 odds, secrets or private paths changed. Remain Draft and do not merge.

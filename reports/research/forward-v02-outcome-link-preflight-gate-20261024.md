# Forward Vault v0.2 outcome/decision reference preflight (2026-10-24)

**Status: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only synthetic content verification. **No independent settlement authentication, ROI scoring, production connection, or promotion authority.**

## Authority and evidence

- Canonical main at inspection: `2342494f6581c167a5648681ca7374b26d6659d4`.
- Existing research PR: #2286. Implementation commit `32845c5b584a035c4f2f325d17574ea5da369598`; synthetic regression commit `8f591f0a0178a1988be6c8bce23507fe2620ede8`.
- Source: `src/research/governance/forwardV02OutcomeLinkPreflight.ts`.
- Tests: `src/research/governance/forwardV02OutcomeLinkPreflight.test.ts` (17 new synthetic tests).
- Official PR CI: Actions run `40031574873`, **verify SUCCESS**, **research-governance SUCCESS**. Test summary: **4,249 total / 4,247 pass / 2 skip / 0 fail**. New synthetic cases were observed in the verify job log.
- Reused architecture: `docs/architecture/forward-evaluation-vault.md`, `docs/architecture/outcome-learning-ledger-contract.md`, `docs/architecture/research-knowledge-retention-contract.md`.
- Reused Learning: `LEARN-outcome-ledger-reconciliation-nonboolean-exact-20261020`, `LEARN-forward-vault-refund-evaluability-contract-drift-20261018`, `LEARN-github-write-readback-20260918`.

## Question and bounded mechanism

Can an unapproved v0.2 source-manifest reference be checked against *actual canonical research-ledger record contents*, rather than accepting caller-provided 64-character hashes and unverified EXACT flags?

The isolated preflight first requires the v281 formula/manifest reference gate, then checks manifest-ordered SHA-256 equality against canonical Runtime Decision Ledger and Outcome Learning Ledger records. It also checks exact race, ticket, selection, decision and decision-record identities, BUY linkage, supported stage mapping, and settlement chronology with submillisecond precision. Duplicate decision/outcome identities and multiple settlement records for one decision fail closed pending independent supersession resolution.

The source manifest may retain valid REFUNDED or VOID records, but the preflight flags them as excluded; it **never** turns them into an evaluable payout/loss. It does not assume recommended stake equals actual wager stake.

## Synthetic observations and falsification

The 17 regression cases include matching digests, post-manifest payout/decision tampering, wrong ticket/race/decision linkage despite freshly recomputed hashes, manifest mismatch, valid refund/void exclusion, invalid evaluable refund, submillisecond future-information chronology, stage mismatch, duplicate identity, ambiguous settlement revisions, WATCH linkage, malformed arrays, cardinality mismatch and asserted scoring authority.

A falsifying case would be any malformed or mislinked fixture that returns `outcomeReferencesLinked: true`, any valid refunded/void fixture that is treated as a scorable settlement, or any path returning `scoringAuthorized: true`. These were not observed in the verified synthetic tests. **No real race/outcome, private T-5 odds, private source path, or N2 diagnostic attempt was used.**

## Explicit limits / remaining engineering gates

1. **Content equality is not independent provenance.** Caller-supplied matching decision/outcome bytes, digest arrays or reconciliation flags cannot prove authoritative source acquisition, final settlement identity or `EXACT` reconciliation. The result always includes `INDEPENDENT_EXACT_SETTLEMENT_NOT_ATTESTED`.
2. **A post-outcome source manifest is not prospective enrollment proof.** The manifest includes outcome digests and can be created after results. It must not be repurposed as the pre-decision cohort freeze. The result always includes `PROSPECTIVE_ENROLLMENT_NOT_ATTESTED`. An independently timestamped, append-only enrollment protocol and membership/snapshot lineage remain necessary.
3. **Untouched holdout mapping is not defined in Runtime Decision Ledger 0.1.** The Vault stage `UNTOUCHED_HOLDOUT` has no explicit corresponding Runtime Ledger `evaluationMode`. The preflight rejects it as `UNSUPPORTED_STAGE_MAPPING`; it must not be silently treated as validation or historical.
4. **Settlement revision authority is unresolved.** Two terminal settlement records for one decision require an independently established supersession rule and cannot both enter a scored result.
5. **v0.2 protocol remains UNAPPROVED.** Frozen common-cohort membership, max-hit exclusion policy, minimum samples, refund denominator, independently sourced outcome reconciliation and human review remain outside this helper.

Next safe step: implement independent, metadata-only evidence of prospective enrollment and settlement finality with versioned source identity, chronology and explicit supersession; verify in isolated synthetic fixtures. Do not activate protected N2 or connect any production path.

## Learning gate

- Classification: **REUSED_LEARNING / NO_NEW_LEARNING**. This integrates existing fail-closed ledger and refund guardrails; no new root-cause class or independently verified production success is asserted.
- fingerprintKey: `research-k3.forward-vault.v02-outcome-ledger-reference-linkage`
- attemptSignature: `pr2286-v282-ordered-decision-outcome-digest-and-ticket-link-preflight`
- environmentKey: `github-connector/research-pr-ci-node24`
- materialStateKey: `forward-vault-v02-candidate/pr2286-be468806/reference-only-no-independent-attestation`
- gate: `PROCEED_DISTINCT_SYNTHETIC_CROSS_LEDGER_PREFLIGHT / REUSE_EXISTING_GUARDRAILS`
- New `LEARN-*`: none.

**Merge gate remains blocked** even though CI is green. No Current BUY, LINE, automated betting, production settings, public publishing, Owner Dashboard or protected N2 activation was changed.

# Runtime Decision Ledger shadow evidence — generatedAt/contentDigest trust-boundary audit (2026-10-30 JST)

**Decision: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only, static contract audit. No independent clock, source issuer, rights grant, authenticated revision/finality, frozen cohort, approved scoring protocol, or production authority is established. No protected N2 execution, Current BUY/LINE/public/automated-betting/settings/Owner Dashboard change, private raw T-5 odds, secrets, or private filesystem paths.

## Distinct question and method

Does a syntactically valid `generatedAt` inside the sanitized Runtime Decision Ledger shadow evidence become cryptographically bound to the evidence, and may a downstream consumer treat that field or `contentDigest` as an authenticated observation time?

**No.** This is an intentional content-identity design boundary, **not** a newly discovered hash collision or validator bypass. The code explicitly excludes `generatedAt` and `contentDigest` from the object hashed for `contentDigest`. The existing test `content digest is stable across generatedAt changes` requires two distinct valid generation times to produce the same digest. The validator checks `generatedAt` for canonical UTC syntax but recomputes the content digest from the other fixed fields; it does not independently authenticate report creation time or the source's clock. These are **static source/test observations**, not a new executed runtime experiment or a signed-time claim.

Source-of-truth inspection:
- `src/research/governance/runtimeDecisionLedgerShadowEvidence.ts`: `digestableEvidence`, builder's `contentDigest: digest(digestableEvidence(base))`, `canonicalGeneratedAt`, and validator's final digest reconstruction.
- `src/research/governance/runtimeDecisionLedgerShadowEvidence.test.ts`: `content digest is stable across generatedAt changes` and `resign` helper excluding the same fields.
- `config/research-governance/runtime-decision-ledger-shadow-evidence.schema.json`: version `runtime-decision-ledger-shadow-evidence.0.1`; descriptions now state the non-authority semantics explicitly in [schema-only commit f45ae27e](https://github.com/m-shogo/boat-pon/commit/f45ae27e5455e06ce58d11d1637e0f9cf4468543). JSON Schema validation behavior is unchanged.

## Evidence/authority separation

| Claim | What the current v0.1 checks | What it **does not** prove |
| --- | --- | --- |
| `generatedAt` | Canonical UTC date-time shape in the TypeScript validator | A trusted clock, immutable issuance event, capture time, or predecision witness; it is not in `contentDigest` |
| `contentDigest` | Canonicalized sanitized content consistency, excluding generation time | Source authenticity, timing, source rights, completeness, correction/finality, or proof that the report was generated at the claimed time |
| `sourceDescriptorDigest` | Consistency with the included local source descriptor | An independent timestamp or attested source record |
| `contextDigest` | A digest-shaped caller claim in the sanitized evidence | An independently retrievable or witnessed original context, cohort freeze, or approved scoring protocol |
| `source.modifiedTimeMs` | A non-negative finite numeric descriptor, included in source content hashing | An independently trusted source clock or proof that the data existed at the decision cutoff |

A consumer that stores or compares two otherwise identical shadow reports with different `generatedAt` values must **not** interpret equal `contentDigest` as equal capture time, or a later `generatedAt` as a signed source correction. Conversely, changing the generation time alone is not evidence of changed research content. These conclusions follow from the v0.1 contract; they do not establish malicious alteration.

## Required downstream guardrail and falsification

1. Preserve v0.1's stable content-identity behavior; do **not** silently redefine the existing digest, backfill fake trusted timestamps, or claim this schema description provides verification.
2. Treat `generatedAt` and `source.modifiedTimeMs` as **untrusted local metadata**. Any prospective cohort/decision cutoff must be independently witnessed *before* the first included decision. Any settlement terminality must use independently authenticated source ordering, complete revision-range checkpoint, and reviewed clock/revocation semantics.
3. Keep `independentAuthorityVerified=false`, `scoringAuthorized=false`, and the PR Draft/blocked while those external capabilities are absent. Do not promote shadow evidence into Current BUY or public output.
4. If a future version needs a signed time binding, specify a **separate versioned attestation** binding canonical content digest, trusted receipt time, issuer/key policy and inclusion proof. Review negative fixtures for forged/backdated time, missing/late witness, revoked clock/key and later correction. This is a future dependency, not an implementation or approval in this audit.

**Falsifier:** a separately provisioned, verifiable external witness receipt or source-issued timestamp bound to the exact content/protocol, with approved trust policy and independently checked timing. A caller-supplied signed-looking field, Git commit time, local `Date`, or a changed `generatedAt` alone does not falsify the blocker.

## Authority, lineage and learning gate

- Canonical `main`: `2342494f6581c167a5648681ca7374b26d6659d4`. Sole open PR #2286 remains Draft/unmerged. Pre-report schema commit `f45ae27e5455e06ce58d11d1637e0f9cf4468543`; no main rewrite or merge.
- Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`; related `reports/research/forward-v02-independent-authority-evidence-contract-20261024.md`, `reports/research/forward-v02-source-finality-ordering-capability-audit-20261026.md`, and `reports/research/forward-v02-K-issuer-role-separation-first-party-audit-20261028.md`.
- Reused `LEARN-shadow-evidence-canonical-own-property-shape-alias-20261029`, `LEARN-shadow-evidence-exotic-prototype-validator-ingress-20261030`, and `LEARN-forward-v02-settlement-revision-anchor-window-20261024`. Historical `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` are dataset inventory, not a witnessed forward freeze; no substantive relevant Rejection record exists in the inspected registry.
- Before this schema/report change, official [CI #40918219817](https://github.com/m-shogo/boat-pon/actions/runs/40918219817) was SUCCESS: 4,653 PASS, 2 SKIP, 0 FAIL; verify, research-governance, production-isolation and post-job steps passed. **This prior CI does not certify the new report/schema change.** Await its own HEAD checks.
- `fingerprintKey`: `research-k3.shadow-evidence.generated-at-content-digest-trust-boundary`
- `attemptSignature`: `pr2286-v454-document-unbound-generatedAt-content-identity-in-schema-and-governance-report`
- `environmentKey`: `github-connector/static-contract-audit/actions-node24`
- `materialStateKey`: `shadow-evidence.0.1-schema@4de73f09-validator@0ecc942a-intentional-generatedAt-exclusion`
- Gate: `PROCEED_DISTINCT / REUSE_GUARDRAIL`. Classification: `REUSED_LEARNING / NO_NEW_LEARNING`. No novel failure or reusable success requiring a duplicate `LEARN-*` record; this audit is a durable governance clarification.

**Next safe action:** verify official CI for this PR HEAD, then prioritize independently attributable K publisher/rights and source correction/finality/time evidence. Keep the Draft gate until external evidence and an approved protocol exist.

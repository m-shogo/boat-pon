# Forward Vault v0.2 — untrusted authority envelope schema boundary (2026-10-24)

**Status: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** This is a research-only, unapproved, metadata-only contract. It is **not** a trust verifier, externally witnessed enrollment, independently authenticated final settlement, scoring authorization, production connection, or real-data evaluation.

## Research question and falsifiability

Can the v287–v288 caller-supplied witness/settlement metadata preflight be given a versioned, closed Draft 2020-12 JSON envelope schema without silently treating self-reported signatures, trust anchors, clocks or FINAL labels as independent evidence?

The testable hypothesis is that a strict schema can reject malformed **shape and lexical** metadata while leaving all cross-field, calendar, chronological, completeness and external-authenticity claims to a separate fail-closed boundary. The claim would be falsified by a schema that admits extra authority-granting fields, an unbounded timestamp pattern, blank-only IDs, unknown `-00:00` offsets, or a runtime preflight that returns `independentAuthorityVerified: true` or `scoringAuthorized: true` for a synthetic self-assertion.

## Authority and lineage

- Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`; research PR: #2286.
- Authoritative contracts: `docs/architecture/research-learning-loop.md`, `docs/architecture/research-knowledge-retention-contract.md`, `docs/architecture/forward-evaluation-vault.md`.
- Prior design and implementation: `reports/research/forward-v02-independent-authority-evidence-contract-20261024.md`, `reports/research/forward-v02-untrusted-authority-metadata-preflight-20261024.md`, `src/research/governance/forwardV02AuthorityMetadata.ts`.
- The canonical-main `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` concern historical dataset coverage, not independent prospective enrollment or terminal settlement. No relevant canonical-main Rejection record was identified; no transfer or production adoption is claimed.

## Implemented bounded change

1. Added `config/research-governance/forward-v02-authority-metadata.schema.json` as a strict, versioned **untrusted** envelope schema. Root, freeze, witness, settlement and revision objects require exact fields and disallow extras. The stage is restricted to SHADOW_FORWARD or FUTURE_ONLY.
2. Required unique membership IDs, a nonempty expected universe, dense revision-array semantics at the JSON level, safe positive revision sequence, 64-character lowercase SHA-256 lexical digests, explicit disposition/finality enums, and nullable predecessor digest.
3. Reused existing Learning guardrails: exact uppercase RFC3339 lexical pattern (independent of optional JSON Schema `format` assertion), rejection of `-00:00`, and ECMAScript-trim-aligned Unicode nonblank regex. A JSON Schema date-time regex still **cannot** prove Gregorian calendar validity or independently trusted chronology.
4. Added `src/research/governance/forwardV02AuthorityMetadata.schemaContract.test.ts` with six tests checking closed required-field sets, schema lexical rules, enum/cardinality constraints and the denial-only runtime boundary. No full Draft 2020-12 engine is shipped or claimed by this test; a future external schema-validator parity check remains useful.
5. Left `forwardV02AuthorityMetadata.ts`, `forwardScoringAdmission.ts`, the v0.1 vault, Current BUY, LINE, production settings, public publishing, automated betting, Owner Dashboard and protected N2 unchanged.

## Verification

- Commit `d427a54198c4278187379630adcfe2bc6ce26ae6`: schema.
- Commit `eb552036792dbeb1458501436fadec3d47ccf2fd`: six schema-contract tests.
- Official latest-code CI [#40064663984](https://github.com/m-shogo/boat-pon/actions/runs/40064663984): **SUCCESS** at `eb552036792dbeb1458501436fadec3d47ccf2fd`. `verify` and `research-governance` succeeded; **4,299 PASS / 2 SKIP / 0 FAIL**. The verify job log confirms all six new tests executed.
- No real outcomes, source credentials, raw odds, private paths, ROI, readiness counts, trusted witnesses or proof material were read or generated.

## Critical limitations and next safe slice

**Schema validation is not independent attestation.** A caller can fabricate every field while satisfying the schema. JSON Schema alone cannot enforce cross-field digest equality, membership completeness, exact fractional chronology, revision-chain linkage, authoritative source ordering, trusted key material, revocation freshness or terminal settlement authenticity. The existing TypeScript helper checks only some **untrusted internal** consistency and must remain deny-only.

Before any independent authority result or v0.2 evaluation admission can exist, separately review a trust-anchor/clock model, external inclusion/signature proof format, source-specific correction and finality rules, immutable proof identifiers, key rotation/revocation, and a non-production verification fixture. Then independently validate the frozen formula, common-cohort denominators, refunds, exclusions and max-hit policy. **Do not merge PR #2286 merely because CI is green.**

## Learning gate

- `fingerprintKey`: `research-k3.forward-vault.v02-untrusted-authority-envelope-schema-parity`
- `attemptSignature`: `pr2286-v289-strict-untrusted-envelope-schema-and-six-contract-tests`
- `environmentKey`: `github-connector/research-pr-node24-ci`
- `materialStateKey`: `forwardV02AuthorityMetadata.0.1-untrusted/pr2286-8a77f99a/schema-absent`
- Gate: `PROCEED_DISTINCT_SCHEMA_CONTRACT / REUSE_VERIFIED_GUARDRAILS`. No equivalent unchanged failed attempt found.
- Reused: `LEARN-forward-vault-schema-format-annotation-lexical-bypass-20261016`, `LEARN-forward-vault-schema-unknown-offset-parity-20261016`, `LEARN-forward-vault-schema-unicode-trim-parity-20261019`, `LEARN-github-write-readback-20260918`.
- Classification: **REUSED_LEARNING / NO_NEW_LEARNING**. Existing schema-runtime guardrails were applied to a new untrusted envelope; routine successful CI is not a new independent proof or non-obvious new root cause. No duplicate `LEARN-*` record is warranted.

**Isolation:** research-only metadata and synthetic tests. No protected N2 activation, production modification, or authority escalation.

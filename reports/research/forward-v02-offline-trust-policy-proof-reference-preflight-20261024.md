# Forward Vault v0.2 — offline trust policy/proof-reference boundary (2026-10-24)

**Decision: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only, synthetic, deny-only. No independently provisioned keys, signature verification, witness inclusion, trusted clock, revocation service, finality verification, approved scoring contract, private data, Current BUY, LINE, public publishing, automated betting, production settings, Owner Dashboard, or protected N2 activation.

## Authority and novelty gate

Canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`. Sole open PR: #2286, prior HEAD `f53aebfd3ea06201c1057dc9c11f66847cebb2fd`. The latest prior official PR CI #40073054427 was green for verify and research-governance; this only verified the previous synthetic boundary. Inspected latest-main `docs/architecture/research-learning-loop.md`, `docs/architecture/research-knowledge-retention-contract.md`, `EXP-dataset-expand-701398c2`, `DISC-dataset-coverage-701398c2`, and relevant append-only LEARN records, especially `LEARN-forward-v02-cross-envelope-authority-id-replay-20261024`, `LEARN-outcome-ledger-array-iterator-admission-bypass-20261021`, `LEARN-github-write-readback-20260918`, `LEARN-forward-vault-year-zero-formatchecker-parity-20261015`, and `LEARN-actions-self-hosted-ten-minute-red-jobs-20261008`. No canonical-main Rejection for independent forward evidence was found. Recent settlement/selector merged PRs concern distinct historical research validation and cannot be promoted into this unapproved forward candidate.

- `fingerprintKey`: `research-k3.forward-vault.v02-offline-trust-policy-proof-reference-binding`
- `attemptSignature`: `pr2286-v292-synthetic-offline-role-issuer-key-window-proof-ref-deny-only-preflight`
- `environmentKey`: `github-connector/research-pr-node24-ci`
- `materialStateKey`: `forwardV02AuthorityMetadata.0.1-untrusted/pr2286-f53aebfd/no-offline-trust-policy-binding`
- Gate: `PROCEED_DISTINCT_SYNTHETIC_POLICY_PREFLIGHT / REUSE_VERIFIED_GUARDRAILS`. No unchanged matching failure; this is distinct from v291 issuer-scoped receipt and source revision ID replay checks.

## Implemented boundary

`src/research/governance/forwardV02TrustPolicyPreflight.ts` checks a *caller-supplied, explicitly UNTRUSTED* versioned policy snapshot and proof-reference envelope against the already validated untrusted authority metadata. The offline preflight denies malformed or duplicate role-scoped anchors; unsupported algorithms or year-zero/calendar-invalid UTC validity bounds; unreviewed policy metadata; missing/changed issuer and source bindings; revoked or out-of-window keys; and mismatched receipt, revision and policy snapshot identifiers. Closed own-data object shapes and indexed array traversal reject accessors, sparse arrays, unknown authority-granting fields, and iterator-dependent admission.

`src/research/governance/forwardV02TrustPolicyPreflight.test.ts` adds **12 synthetic contract tests**. A caller can label the snapshot `REVIEWED`, supply a matching Ed25519-shaped key fingerprint and proof digests, and still receive only `UNVERIFIED_WITNESS`, `UNVERIFIED_SOURCE`, `UNAPPROVED_PROTOCOL`, with literal `independentAuthorityVerified: false` and `scoringAuthorized: false`. This code does not read a public key, verify any signature, contact a trust service, prove clock integrity, or establish authoritative finality. A caller-selected policy snapshot is never an external trust root.

Commits:
- `7b6b5b788c162c74803881ab3e066ef98a7ab5f4`: deny-only preflight.
- `3b90d6d6dc409316ca571ed933ca1a23ad2507c6`: 12 synthetic regression tests.
- `c366c8bdafa4ca852d583cc98220fecaf125f48a`: reuse year-zero timestamp parity guardrail.
- `964c1f03f17bb369a5c182fd781bc285bf39e586`: lock year-zero rejection regression.

CI on the test HEAD: [Actions #40076321006](https://github.com/m-shogo/boat-pon/actions/runs/40076321006) (check final conclusion before citing success). The previous green CI must not be conflated with this HEAD.

## Natural N2 red workflow interpretation

Feature Rollup #40003695814 full 228-line log: payload `NO_CHANGE`, process step success, post-job cleanup success, workflow job FAILURE; self-hosted runner/platform finalization cause unproven. Daily Readiness #39834565537 full log: `DAILY_PLAN_MISSING`, exit code 3, job FAILURE, cleanup success. Daily Readiness #40005501493: job FAILURE, logs unavailable, no payload conclusion. Natural Feature Rollup #40050991961 queued; #40074049575 pending at gate. These observations do not establish readiness or justify activating protected N2.

## Limitations and next review

The API is deliberately **not** a verifier port capable of producing `true`. Future independent verification needs a separately reviewed, immutable trust-anchor provisioning model, source-specific revocation freshness, verified signature/inclusion and clock semantics, authenticated terminal correction-chain completeness, and approved v0.2 protocol/denominator/refund/max-hit policy. None is implemented here. No merge or scoring authority follows from structural CI.

Learning classification: `REUSED_LEARNING / NO_NEW_LEARNING`. Existing deny-only, iterator-independent, year-zero schema/runtime parity, read-back and layered N2 failure interpretation guardrails were reused. No new root-cause class or independently verified trust success is asserted; do not create a duplicate LEARN record for routine synthetic verification.

# Research digest encoding boundary audit — raw UTF-8 vs canonical JSON (2026-10-28)

**Decision: REUSED_LEARNING / NO_NEW_LEARNING.** Bounded research-only audit; **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE** remains unchanged. This is not source authentication, trusted settlement, evaluation readiness, scoring permission, or production authority.

## Question and scope

After the standalone Forward v0.2 request and source-manifest digests were hardened against unpaired UTF-16 surrogates, does the *same UTF-8 replacement alias* justify changing the other three research-ledger canonical digest implementations?

Authority: canonical `main` `2342494f6581c167a5648681ca7374b26d6659d4`; open PR #2286 head before this audit `5a2113ae6638a933c40752bd91919815e5ff29e5`. Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`, the v410/v411 UTF-16 Learning records, the prior direct-helper and strict-ingress audits, dataset-foundation `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2`, and merged #2284/#2285. The dataset records confer no v0.2 independent-evidence or prospective-freeze authority; no relevant Rejection lineage was identified in the prior bounded authority audit.

Inspected on the PR head:

- `src/research/governance/forwardV02UntrustedVerifierResponse.ts`: standalone request digest length-prefixes **raw UTF-8**; rejects malformed UTF-16 before `hash.update(value, "utf8")`.
- `src/research/governance/forwardV02ReferenceReconciliation.ts`: source-manifest reference digest length-prefixes **raw UTF-8**; rejects malformed UTF-16 in the only unconstrained hashed string, `manifestId`. Other hashed strings are constants, SHA-256 lowercase hex, strict ASCII timestamps, or fixed enum values.
- `src/research/governance/forwardEvaluationVault.ts`: `forwardVaultDigest` validates, canonicalizes, then hashes `JSON.stringify(canonical(record))`.
- `src/research/governance/runtimeDecisionLedger.ts`: `runtimeDecisionLedgerDigest` validates, canonicalizes, then hashes `JSON.stringify(canonicalize(record))`.
- `src/research/governance/outcomeLearningLedger.ts`: `outcomeLearningLedgerDigest` validates, canonicalizes, then hashes `JSON.stringify(canonicalize(record))`.

This is a five-module **source and encoding-mechanism audit**, not an exhaustive call graph, mutation-resistance proof, schema-completeness proof, or assertion that every research digest is safe.

## Reproducible synthetic encoding check

Ran a read-only Node.js **22.16.0** probe using `node:crypto` SHA-256 on the strings `"\\uD800"` (isolated high surrogate), `"\\uDC00"` (isolated low surrogate), and `"\\uFFFD"` (literal replacement character). No repository data, private evidence or credentials were used.

- Raw `Buffer.from(value, "utf8")` is **`efbfbd` for all three**; raw UTF-8 hashes are identical. This reproduces the v410/v411 failure mechanism.
- `JSON.stringify({id: value})` emits **distinct JSON text**: `{"id":"\\ud800"}`, `{"id":"\\udc00"}`, and `{"id":"�"}` respectively.
- SHA-256 of those three JSON strings is **different**: `959de2b22575...`, `f9615ca05fb5...`, and `60e92b635610...`. A valid surrogate pair (rocket emoji) also retains its distinct UTF-8 representation.

The test establishes only this specific UTF-16 replacement-alias distinction in the observed Node runtime. It does **not** prove collision resistance against arbitrary malformed inputs or protect a validator/canonicalizer from concurrent mutation or ambient prototype interference.

## Decision and repeat suppression

**No ledger-code mutation or duplicated UTF-16 rejection test is justified by the v410/v411 raw-UTF-8 alias alone.** The three inspected ledger digest functions hash JSON text, where lone surrogates are escaped before UTF-8 conversion, so the demonstrated replacement-byte alias does not transfer to that path. Their admission and mutation boundaries must be assessed separately against the existing ledger Learning records; do not conflate a raw UTF-8 correlation-ID defect with a JSON-canonical digest defect.

Normalized gate:

- `fingerprintKey=research-k3.forward-vault.raw-utf8-vs-json-canonical-digest-alias-scope`
- `attemptSignature=pr2286-v412-five-module-static-encoding-audit-node22-three-synthetic-string-probe`
- `environmentKey=github-connector/local-node22.16.0/github-actions-node24-typescript6.0.3`
- `materialStateKey=pr2286-v411-raw-utf8-utf16-guards-and-ledger-json-canonical-digest-implementations`
- `gate=REUSE_GUARDRAIL / PROCEED_DISTINCT_SCOPE`; reused `LEARN-forward-v02-standalone-request-utf8-replacement-alias-20261028`, `LEARN-forward-v02-source-manifest-utf8-replacement-alias-20261028`, `LEARN-forward-v02-utf16-test-double-escape-fixture-20261028`, and the existing ledger digest-admission Learning. No new failure, non-obvious reusable success or new `LEARN-*` is claimed.

At audit start the latest official PR-head Actions run [#40669796899](https://github.com/m-shogo/boat-pon/actions/runs/40669796899) completed SUCCESS (verify and research-governance, including post-job steps). **This report commit requires its own latest-head CI observation; the earlier run does not validate the new commit.** No red workflow was retried, and protected N2 was not activated.

## Remaining external dependencies and next safe action

Independent K-data issuer and usage rights, authenticated correction-chain completeness and terminality, trusted time/revocation, prospective frozen evaluation membership and an approved evaluation protocol remain unavailable. Do not infer readiness or merge #2286 from this audit.

Next: audit a *demonstrated* caller-controlled digest/validation mismatch with a concrete minimal synthetic reproducer, or prioritize independently attributable K-source specifications if new evidence appears. Avoid speculative global UTF-16 refactors and repeated source-page scraping. No Current BUY, LINE, automated betting, public publishing, Owner Dashboard, production behavior/settings, raw T-5 odds, private paths or secrets were touched.

# Forward Vault v0.2 — untrusted proof-request identifier path-token privacy guard

- Date: 2026-10-31 UTC/JST
- Evidence stage: **SYNTHETIC_OFFLINE_ENGINEERING**, no source data, no N2 activation
- Authority: **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE**
- PR: #2286, canonical main pinned at `2342494f6581c167a5648681ca7374b26d6659d4`
- Outcome: bounded fail-closed research-only privacy hardening; no independent K issuer, rights, settlement or scoring authority

## Question and prior learning

Can the metadata-only independent proof-request builder export caller-supplied local filesystem path tokens inside otherwise nonblank, allowlisted identifier strings? The request deliberately excludes private path *fields*, but exact-field allowlisting alone does not constrain identifier *contents*.

Pre-attempt learning gate: `PROCEED_DISTINCT / REUSE_GUARDRAIL`. Reused `LEARN-shadow-evidence-embedded-absolute-path-token-admission-20261029` for the previously established distinction between leading-only path checks, embedded path tokens and benign HTTPS metadata. This is a different v0.2 request-builder material boundary; no prior matching retry was found. Main's Experiment `EXP-dataset-expand-701398c2` and Discovery `DISC-dataset-coverage-701398c2` concern historical coverage and do not authorize this proof request. No relevant Rejection record exists on canonical main.

## Source mechanism and bounded change

At the previous PR HEAD `464af094e763`, `forwardV02AuthorityMetadata.ts` and the policy preflight accepted nonblank caller IDs, and `forwardV02IndependentProofRequest.ts` copied the allowed identifiers into the exported request without a local-path lexical check. This is a **source-level synthetic admission risk**, not evidence of an actual secret or private path being exported.

The request builder now denies synthetic embedded POSIX, drive-letter, UNC and file-URL path-looking tokens in all exported free-form identifiers: cohort, witness issuer/receipt/anchor, settlement source/anchor, terminal revision and every correction-chain revision ID. It returns only the generic `PRIVATE_PATH_METADATA` blocker, `request=null`, `independentAuthorityVerified=false`, and `scoringAuthorized=false`. No input value is reflected in the blocker. It preserves benign HTTPS URI and namespace-style identifiers. The stricter Node ingress delegates to the same deny-only check.

The lexical guard is deliberately **not** a universal secret scanner, an arbitrary-value redactor, an independent verifier, or a legal usage-rights grant. Encoded/obfuscated values and all other future transports require separate privacy review.

## Reproducible synthetic verification

- Code: `0701a25c65d10fe8889bec11041d090bc41791dd`, corrected regex literal `3194b65100bb818e8702cd8c3e459017f5a9852e`
- Test: `0ae9a8b58db4ceeeed53fab759534b130534c5d2`
- Test file: `src/research/governance/forwardV02IndependentProofRequest.test.ts`
- Protocol: seven synthetic identifier-mutation categories, each assessed through normal and strict Node request ingress; both must reject without emitting a request or echoing the synthetic token. Two benign identifier controls must remain structurally admissible but unverified.
- No private raw T-5 odds, account data, secrets, real private paths, source proof, real tickets, ROI, production settings or external services were accessed.
- Official exact-HEAD CI: [Actions #41203512264](https://github.com/m-shogo/boat-pon/actions/runs/41203512264), **SUCCESS**. Full verify log confirms the named regression ran: **4,689 PASS / 2 SKIP / 0 FAIL (4,691 total)**. Research governance, typecheck, build, replay, secret scan, production-isolation and post-job cleanup succeeded. Nonfatal Node deprecation warnings remain.

## Falsification and limitations

The finding would be falsified if a pre-change strict builder already rejected every synthetic path token *before* constructing the request; the source inspection found no such lexical check. The remediation would be falsified if a listed synthetic path mutation yielded a non-null request or if a benign HTTPS/namespace control were rejected. Neither occurred in the official regression.

This is only an identifier-output privacy boundary, not proof of data confidentiality in arbitrary strings or transport/storage. It does not authenticate witness signatures, correction/finality, exact-ticket return kind, K-data usage rights, frozen cohort, or approved scoring protocol. It does not increase readiness counts.

## Next safe action

Keep #2286 Draft. Seek independently attributable K issuer/usage-rights and source-authenticated ticket-level return-kind/correction/finality evidence. Any future verifier or metadata transport must have its own independently reviewed privacy and provenance contract. Never activate protected N2 for diagnostics or connect to Current BUY, LINE, public publishing, automated betting, production settings, or Owner Dashboard.

# Forward Vault v0.2 — K-provider clarification and evidence-request decision packet (2026-10-26)

**Decision: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only, documentation-only governance artifact. No provider contacted; no provider rights, source signature, independent finality, complete correction history, trusted clock, positive verifier, scoring permission or production connection has been obtained. No archive or private evidence was fetched.

## New question and bounded method

Following the v350 public settlement-source review and v351 K-download documentation audit, **which accountable issuer/contact route can actually answer the missing K archive rights, correction-history and terminality questions, and what minimum written evidence would change the research decision?** This is a *routing and acceptance-criteria* audit, not another attempt to parse the K landing page. The earlier zero-extractable-text result is not retried or interpreted as service failure.

Reviewed public, first-party organization/navigation pages on 2026-10-26:

- BOAT RACE official download index: https://boatrace.jp/owpc/pc/extra/data/download.html — points to the K results-download landing page https://www1.mbrace.or.jp/od2/K/dindex.html. An outbound link **does not identify the contractual K publisher or establish research rights**.
- BOAT RACE official FAQ/navigation: https://boatrace.jp/owpc/pc/extra/tb/support/faq.html and site-wide FAQ category https://boatrace.jp/owpc/pc/extra/enjoy/guide/faq/index.html — public support/FAQ navigation exists, but the inspected pages **do not identify a K-data licensing, corrections or authenticated-feed contact**.
- Japan Motor Boat Racing Association official organization description: https://www.mbkyosokai.jp/gaiyou.html — describes responsibilities for race operation/competition administration; **not proof that the association issues, licenses or operates the K archive host**.
- Association public home page: https://www.mbkyosokai.jp/ — exposes organization, news and location navigation, but **no verified K-specific data-rights/attestation contact** was established in this bounded review.
- BOAT RACE TELEBOAT help: https://boatrace.jp/owsp/sp/extra/tb/support/otoiawase.html — explicitly concerns betting membership/telephone-internet betting. **Do not treat it as a data-provider licensing or settlement-finality authority**.
- The official boatrace.jp site policy https://www.boatrace.jp/owpc/pc/extra/policy.html was reviewed in v351. Its rights and disclaimer text must **not** be silently transplanted into a separate K-host license.

**Routing finding:** a possible site-wide FAQ escalation route is *discoverable*, but no verified authorized K issuer, K-specific inquiry endpoint or grant of use rights is established. Do not invent a contact address, send an inquiry, scrape bulk archives or infer authorization from the host name. A human may use official published organization/support navigation to request the responsible data office; only an attributable issuer response can resolve the dependency.

## Issuer evidence request — written answers and independently verifiable artifacts

The following questions are deliberately scoped to **metadata/specifications and rights**, not private data or operational credentials. Any future contact must be separately authorized and sent by a human or approved workflow; this run sent nothing.

| Question to responsible K issuer | Required written evidence / artifact | Gate if absent |
| --- | --- | --- |
| Who legally publishes the K archive, and who is authorized to grant research collection/retention rights? | Named issuing entity, scope/host mapping, applicable terms, permission for intended automated access, retention and derivative research; explicit redistribution restriction | RIGHTS_REVIEW_REQUIRED |
| What is the K file schema, encoding, date/venue coverage and publication/update/replacement schedule? | Issuer-authored versioned format and publication policy, with effective dates and documented correction/retention behavior | FORMAT_AND_UPDATE_UNVERIFIED |
| Can a previously published K result be replaced or corrected, including after a displayed FINAL result? | Issuer-defined correction lifecycle, revision identity, replacement vs append semantics, withdrawal and post-final policy | UNRESOLVED_FINALITY |
| Is there an authenticated **inclusive revision-range** or append-only event checkpoint for each result? | Source-issued revision IDs, predecessor/supersession links, signed/otherwise independently authenticated ordering, checkpoint/inclusion/completeness proof and fork/tie handling | INCOMPLETE_REVISION_CHAIN |
| How is terminality attested *through a named checkpoint* rather than inferred from latest observation? | Source-defined terminal watermark, late-correction policy, revocation/supersession handling and independent proof of checkpoint authority | UNRESOLVED_FINALITY |
| How are issuer keys, clock assertions and revocations independently provisioned and validated? | Approved key/algorithm roster, source-controlled time basis, key validity/rotation/revocation and verifiable proof acquisition independent of caller metadata | UNVERIFIED_SOURCE |
| Does an official race result encode exact-ticket refunds, voids and cancellations, or is a separate source required? | Source-authenticated race/ticket/bet-type/selection/stake/payout/refund mapping and scope limits; distinguish published refund-boat markers from exact ticket adjudication | UNRESOLVED_IDENTITY / UNRESOLVED_REFUND_OR_INVALIDATION |

A provider statement that data are “official,” “confirmed,” “daily updated” or “HTTPS available” **does not** answer the source-order, completeness, terminality, exact-ticket or rights questions. A vendor that merely mirrors the K files is not automatically an independent source of source-issued correction proof.

## Evidence intake and acceptance criteria (future work only)

1. Record the response's **issuing organization, attributable document identity, issue/effective date, source URL or authorized correspondence reference, license scope and version** in a sanitized research report. Do not commit private correspondence, signatures, keys, raw archives or local paths.
2. Distinguish **documented claim** from **independently testable proof**. An issuer-authored statement may resolve a documentation question without proving that every historical correction is complete. Do not set `independentAuthorityVerified=true` from correspondence.
3. Independently review trust policy and proof mechanism **outside the caller request**. Require a bounded authenticated range checkpoint and complete predecessor/supersession chain for the exact settlement revision, including post-FINAL changes; no local polling timestamp or hash-only substitute.
4. Review rights **before any payload ingestion**, and only then design a separate, offline synthetic-first denial harness. The existing 18 negative vectors are **SPECIFICATION_ONLY_NOT_EXECUTABLE**; no positive verifier or score may be inferred.
5. Keep prospective eligible-universe witness, protocol approval and exact ticket/refund settlement as **separate independent blockers** even if K-specific source documentation improves.

## Decision and falsifiers

**Current decision: no confirmed authorized K-data contact, rights grant or authenticated correction/finality evidence.** The public support/organization pages provide a *human routing lead*, not a provider attestation. The next non-conflicting step is **human-confirmed issuer identification and written specification/rights request**. If that cannot be obtained, retain the explicit external dependency and avoid further redundant page-scraping or speculative verifier APIs.

Falsifier: an attributable, versioned issuer specification plus independently verifiable correction-order/completeness/finality evidence and reviewed intended-use rights would justify a *new*, separate, read-only review. It would **not** alone approve cohort freeze, evaluation protocol, scoring, merge or production.

## Authority, lineage and learning gate

- Latest canonical main at pre-write gate: `2342494f6581c167a5648681ca7374b26d6659d4`; sole open research PR #2286, pre-write head `c2ac36525f78fcf8a934072ec6613002df03e508`; latest PR CI #40272270391 verify and research-governance **SUCCESS**. Latest main learning-loop and knowledge-retention contracts read. Merged #2284/#2285 reviewed. Relevant `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2` reviewed; no substantive Rejection record in registry. Historical dataset coverage is not independently authenticated K correction/finality proof.
- Prior research: `reports/research/forward-v02-source-finality-ordering-capability-audit-20261026.md`, `forward-v02-official-settlement-source-capability-review-20261026.md`, `forward-v02-official-download-documentation-boundary-audit-20261026.md`, and the 18-vector negative specification. Reused `LEARN-forward-v02-settlement-revision-anchor-window-20261024`, `LEARN-forward-v02-negative-catalog-first-denial-precedence-20261026`, `LEARN-forward-v02-negative-catalog-case-semantics-drift-20261026`. No failed two-phase snapshot or K page-text extraction retry.
- `fingerprintKey=research-k3.forward-vault.v02-K-provider-issuer-routing-and-evidence-request`
- `attemptSignature=pr2286-v352-first-party-organizational-contact-route-trace-and-written-evidence-acceptance-checklist`
- `environmentKey=github-connector/public-official-web-docs-only`
- `materialStateKey=forward-v02-pr2286-v351-K-issuer-contact-rights-and-authenticated-correction-proof-unestablished`
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. Classification: **REUSED_LEARNING / NO_NEW_LEARNING**; no new independent root-cause failure or non-obvious verified success, so no filler LEARN.
- Red workflow triage read full logs: CI #40252035951 test-contract assertion failure (process exit 1; verify job failure, governance success), CI #40251957759 TypeScript TS7053 (process exit 1; verify/build and governance/typecheck failure); post-checkout cleanup successful and no demonstrated runner/platform fault. Natural protected N2 #40218434947 had `DAILY_PLAN_MISSING`, process exit 3, workflow failure, post-checkout success and no demonstrated runner fault. **No N2 rerun or diagnostic activation**.

**Non-interference:** `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`; no Current BUY, LINE, public publishing, automated betting, production behavior/settings, Owner Dashboard or protected N2 changes. No private raw odds, secrets or private paths. **ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE** remains canonical; this report requires its own latest-head CI check before CI-success claims.

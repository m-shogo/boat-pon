# Forward Vault v0.2 — official website policy versus K-archive usage rights (2026-10-31 JST)

**Decision: RIGHTS_REVIEW_REQUIRED / ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Public-documentation-only research. No archive, API, private odds or account data was fetched; no permission was requested or inferred. No production, Current BUY, LINE, publishing, automated betting, protected N2 or Owner Dashboard change.

## Narrow question and first-party finding

Can the official BOAT RACE website's current public site policy serve as an affirmative license to ingest, retain, reproduce or redistribute K result files for automated research? **No affirmative grant is present in the reviewed policy.** This is a narrower, newly inspected first-party *terms-of-use* boundary, not a repetition of the K-host issuer-role or third-party derivative-source audit.

Primary source inspected on **2026-10-31 JST**: [BOAT RACE official website site policy](https://www.boatrace.jp/owsp/sp/extra/policy.html), operated on `boatrace.jp` by 一般財団法人BOATRACE振興会. Its copyright section states that website content is protected by the foundation or third parties, disallows use beyond statutory exceptions or content-specific conditions without rights-holder permission, and expressly says the site does not grant rights in that content. The prohibited-conduct section also addresses excessive requests that disrupt operation. The disclaimer warns that published information may become stale and that URLs/content may change without notice. [Official site information](https://boatrace.jp/owsp/sp/extra/about.html) says displayed closing odds are **not** final confirmed odds and do not reflect start-accident effects.

**Critical scope limitation:** these are terms for `boatrace.jp` content, **not** a demonstrated contract governing the distinct K download host or its data issuer. The policy does not establish who owns rights in individual factual numeric results, whether a particular use falls within a statutory exception, or whether a separate K-specific license exists. No blanket legal prohibition or permission for all numeric data is inferred. Public visibility, free viewing, official navigation, and third-party API terms do not independently grant K ingestion/retention/redistribution rights.

## Decision table — what the policy actually establishes

| Claim | Evidence | Research admission |
| --- | --- | --- |
| `boatrace.jp` website content is openly licensed for arbitrary reuse | Official policy contains **no affirmative license** | **NOT ESTABLISHED** |
| K host is the same contractual publisher/rightsholder as `boatrace.jp` | No K-host-specific statement in this policy | **UNVERIFIED ISSUER / RIGHTS** |
| Public access implies permission for automated bulk retrieval and indefinite raw retention | No scoped grant; operational-disruption restriction exists | **RIGHTS REVIEW REQUIRED; no collection** |
| Closing odds prove final settled ticket returns | Official site explicitly distinguishes closing and final odds | **REJECT EQUIVALENCE** |
| Site terms prove authenticated corrections, source ordering, finality, refund/special payout or a frozen evaluation cohort | No such source-signed evidence in the policy | **UNVERIFIED / UNSCORABLE** |

## Single next human evidence request (reuse existing packet)

Use the existing [K-provider clarification packet](forward-v02-provider-clarification-evidence-request-20261026.md), **not** a duplicate outreach. Require a K-host-specific attributable written answer identifying: (1) publisher and actual rightsholder(s); (2) whether automated retrieval, internal research processing, raw retention, derived feature storage, and any redistribution are each permitted, with rate/retention conditions; (3) which K file version/correction/finality rules are authoritative; (4) whether ticket-level return-kind, refunds and special payouts are covered; and (5) the applicable independently verifiable provenance/clock/revocation evidence. Route through an appropriate verified official data-rights contact, not an assumed TELEBOAT customer-service address. Human legal/rights review is needed for any actual use.

**Falsifier:** a verified K-specific written license or applicable explicit terms and attributable source specification would resolve the relevant rights *question* to its actual scope; it would **not** by itself prove cryptographic finality, exact-ticket settlement or approval to score.

## Authority, learning and limitations

Canonical main at the pre-write authority gate: `2342494f6581c167a5648681ca7374b26d6659d4`. Research Draft PR #2286 HEAD before this report: `57899e8bf35be0bdbd33796faa9aa3ceb36469d5`. Open PR #2287 separately owns LINE. Latest prior exact-head CI [#41171197024](https://github.com/m-shogo/boat-pon/actions/runs/41171197024) completed successfully; this result **predates** this report. No merge attempted.

Read latest-main research learning loop and retention contract, historical `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2`; no substantive main Rejection record. Reused the existing [K issuer role audit](forward-v02-K-issuer-role-separation-first-party-audit-20261028.md), [third-party provenance audit](forward-v02-third-party-derived-source-provenance-rights-boundary-20261031.md), and `LEARN-forward-v02-synthetic-reference-never-authority-20261025` guardrail: a link, digest, or secondary operator is not issuer-authenticated evidence.

- `fingerprintKey=research-k3.forward-v02.official-site-policy-vs-K-host-license-scope`
- `attemptSignature=pr2286-v491-first-party-boatrace-jp-copyright-terms-scope-review`
- `environmentKey=official-public-site-policy-20261031/github-connector-draft-research`
- `materialStateKey=boatrace-jp-policy-no-K-host-specific-grant+existing-issuer-role-and-derived-source-audits`
- Learning gate: `PROCEED_DISTINCT / REUSE_GUARDRAIL`; this is a different official *policy text* from prior K-host/operator and third-party audits. Classification: `REUSED_LEARNING / NO_NEW_LEARNING`; no new failure or non-obvious implementation success justifies another LEARN record.

**No readiness count, rights clearance, positive K attestation, ROI scoring, production connection, or merge authority follows from this finding.**

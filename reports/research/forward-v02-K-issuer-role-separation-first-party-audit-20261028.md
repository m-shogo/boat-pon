# Forward Vault v0.2 — K-archive issuer-role separation from first-party organization evidence (2026-10-28 JST)

**Decision: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only, public-documentation-only evidence routing. **No K archive bytes were downloaded, no provider contacted, no source-specific rights or issuer authenticated, no independent terminality proven, no score or production connection authorized.**

## Distinct question and method

The existing [v352 K-provider clarification packet](forward-v02-provider-clarification-evidence-request-20261026.md) established a public BOAT RACE download link and an unverified human escalation route but could not identify an accountable K-data issuer. This bounded follow-up asks: **do first-party descriptions separate information-system operation from race-result adjudication, so that a future authorized inquiry does not conflate those roles?** It does **not** repeat the prior K landing-page text extraction or scrape archive files.

First-party public sources inspected 2026-10-28:

1. [BOATRACE振興会 — supporting organizations](https://www.boatrace-pr.jp/sp/extra/introduction/operation.html): describes **一般財団法人BOATRACE振興会** as operating BOAT RACE information systems and conducting broader business planning/public relations, while **一般財団法人日本モーターボート競走会** handles competition administration, including judging and inspection. This is **organization-level role evidence**, not K-host ownership, rights or finality proof.
2. [日本モーターボート競走会 — organization and duties](https://www.mbkyosokai.jp/organization.html): its branch judging department decides finishing order/disqualification and winning boats; the central association's remit includes competition administration. This supports a **race-adjudication responsibility lead**, not a claim that it publishes or licenses the K download.
3. [ib.mbrace.or.jp site policy](https://ib.mbrace.or.jp/tohyo-ap-pctohyo-web/policy/policy.html): explicitly identifies BOATRACE振興会 and TELEBOAT as operators of the **ib.mbrace.or.jp telephone/internet betting member site**. **Subdomain scope is decisive:** this policy does not establish operator, license, correction semantics or legal rights for **www1.mbrace.or.jp/od2/K/**. Shared parent-domain spelling cannot bridge that authority gap.
4. [BOAT RACE official download index](https://boatrace.jp/owpc/pc/extra/data/download.html): links to the K result-download landing page, but the link alone does not identify the accountable K publisher, issuer keys, revision-order source, correction completeness or authorized automated research use.

These are public statements about *roles and navigation*. No source-specific signed record, named authorized K contact, rights grant, checkpoint, key/revocation policy, or correction history was discovered in the reviewed documents. Absence from these pages does not prove that such a contract/feed does not exist elsewhere.

## New routing distinction (not provider verification)

| Question for a future authorized human inquiry | Public organizational lead | Required independent answer |
| --- | --- | --- |
| Who operates the K download service and can grant automated research/retention rights? | BOATRACE振興会 is described as an information-system operator **in general** | An attributable K-host-specific operator/publisher and licensing authority, terms, permitted collection/retention, and a named appropriate contact |
| Who decides authoritative race result, disqualification, refund and subsequent correction? | 日本モーターボート競走会's judging role is documented **in general** | Issuer-authored source-to-result responsibility map, terminal/correction lifecycle, exact ticket/refund authority, and escalation owner |
| Who can attest a complete source-ordered revision range and finality checkpoint? | **Neither role description supplies this** | Independently provisioned trust material, source-signed order/inclusion/completeness checkpoint, time/revocation and post-final correction rules |

**Do not assume these are the same organization, different organizations, or either organization's contractual K role.** A future authorized contact should first ask each appropriate official organization to identify the accountable K data office; no addresses, contacts, grants or signed proofs are invented here. Do not use a campaign-specific or betting-membership helpdesk as an assumed K licensing channel.

## Evaluation impact and falsifiers

- Existing v0.2 candidate's caller-controlled digests, FINAL flags and synthetic trust metadata remain **STRUCTURALLY_VALID_UNATTESTED** at best. This organizational role finding cannot set `independentAuthorityVerified=true` or `scoringAuthorized=true`.
- The [source-finality capability audit](forward-v02-source-finality-ordering-capability-audit-20261026.md) still requires authenticated inclusive revision-range completeness, source-specific finality and independently reviewed key/clock/revocation policy. The [provider request packet](forward-v02-provider-clarification-evidence-request-20261026.md) remains the actionable written-evidence checklist; **no duplicate request** is created.
- Falsifier of the **unidentified K-operator** blocker: an attributable K-host-specific official statement identifying the publisher, responsible data office, applicable rights and documented source correction/finality semantics. Falsifier of the **independent proof** blocker requires actual externally verifiable authenticated evidence and separately reviewed protocol; organizational statements alone are insufficient.
- No production/Current BUY/LINE/public/automated betting/settings/Owner Dashboard changes, protected N2 activation, private raw T-5 odds, secrets, or private paths. No external requests to data archives.

## Authority, lineage, learning gate

Pre-write canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`; sole open PR #2286 at `4ff7a7e541e4b6e2bc68b35bec6147d4579100b8`. Read latest-main `docs/architecture/research-learning-loop.md`, `docs/architecture/research-knowledge-retention-contract.md`, Forward Vault architecture; relevant source-finality/provider reports, `LEARN-forward-v02-settlement-revision-anchor-window-20261024` and negative-catalog semantic-drift Learning; `EXP-dataset-expand-701398c2` and `DISC-dataset-coverage-701398c2`; no substantive relevant Rejection found in prior inventory. Recent canonical merges #2284/#2285 are not independent authority proof. Prior Experiment/Discovery historical coverage does not attest a prospective cohort or source correction history.

Official pre-write [CI #40624478193](https://github.com/m-shogo/boat-pon/actions/runs/40624478193) completed SUCCESS: verify **4,593 PASS / 2 SKIP / 0 FAIL** (4,595 total), research-governance SUCCESS, typecheck/build, production isolation, secret scan and post-job cleanup SUCCESS. Full verify/governance logs inspected; no red current workflow or runner incident. This result predates this documentation commit; **do not claim new-head CI until separately verified**.

- `fingerprintKey=research-k3.forward-vault.v02-K-issuer-operator-vs-adjudicator-role-separation`
- `attemptSignature=pr2286-v404-first-party-boatrace-promotion-organization-vs-competition-judging-and-subdomain-policy-scope`
- `environmentKey=github-connector-source-audit+public-first-party-web-documents`
- `materialStateKey=pr2286-v403-K-issuer-contact-unverified-v352-packet-without-info-system-vs-adjudicator-role-evidence`
- Gate: **REUSE_GUARDRAIL / PROCEED_DISTINCT_EVIDENCE**. Reuse prior source-finality/issuer evidence guardrails; do not retry prior failed K-page extraction or generate a positive synthetic verifier.
- Classification: **REUSED_LEARNING** (new first-party routing distinction, but no new technical failure or independently verified reusable guardrail); no filler LEARN.

**Next safe action:** await a separately authorized, attributable K-specific operator/issuer and written rights/specification answer; independently review it before any ingestion or verifier. If absent, retain ENGINEERING_REQUIRED and do not merge/score.

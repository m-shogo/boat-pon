# Forward Vault v0.2 — official public settlement-source capability review (2026-10-26)

**Decision: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Research-only, read-only, metadata-only review of publicly documented BOAT RACE settlement surfaces. This is **not** a source-trust approval, authenticated revision feed, executed verifier, complete settlement history, scoring authorization, or permission to merge. No private odds/raw evidence, credentials, protected N2, Current BUY, LINE, public publishing, automated betting, production settings, or Owner Dashboard were accessed or changed.

## Question and evidence boundary

Can the actual official public settlement surfaces provide the *independently authenticated source order, complete correction range and terminality proof* required by the v349 source-finality capability audit, rather than only a current/historical result view?

Inspected on 2026-10-26 (public pages, not authenticated provider contracts):

1. Official historical **result list** for 2025-10-14, venue code 24: `https://www.boatrace.jp/owpc/pc/race/resultlist?hd=20251014&jcd=24`. It displays race, winning combinations, payouts, and a **返還艇あり** note on 5R.
2. Official **5R result detail**: `https://www.boatrace.jp/owpc/pc/race/raceresult?hd=20251014&jcd=24&rno=5`. It shows an F-classified participant, a **返還** field identifying boat 6, result ranks, and per-bet-type payouts. This establishes what the *published page displays*, not an authenticated correction history.
3. Official **refund glossary**: `https://www.boatrace.jp/owpc/pc/extra/enjoy/guide/jiten/29/y_250.html`. It distinguishes F/L-related ticket refunds from post-start capsizing/falling/stalling, which are not refunded under that explanation. This is a **domain rule**, not evidence that a particular ticket was refunded.
4. Official **data download index**: `https://boatrace.jp/owpc/pc/extra/data/download.html`. It links to race-results downloads for all 24 venues (`www1.mbrace.or.jp/od2/K/dindex.html`), but the reviewed index does not specify cryptographically authenticated revisions, completeness checkpoints, or correction ordering. **The underlying downloadable files, their terms, and their provenance/versioning guarantees were not inspected.**
5. Contrast only (not a candidate trusted source): `https://boatraceopenapi.github.io/` explicitly describes itself as **unofficial**, periodically refreshed and **not guaranteeing accuracy/completeness**. It cannot fill the missing independent-source guarantee merely because its JSON is easy to parse.

No live settlement data, tickets, odds, private paths or provider credentials were downloaded, collected, or committed. A browser-visible page and HTTPS transport are **not** equivalent to a source-signed, append-only event log with independently provable completeness.

## Evidence-to-capability decision matrix

| Requirement | What the reviewed official surfaces support | What remains unproven | Status |
| --- | --- | --- | --- |
| Published race/result identity | Historical result list and race-specific detail have identifiable venue/date/race context | Independently authenticated immutable record identity and binding to a specific decision/ticket | OBSERVABLE_ONLY |
| Result and refund *presentation* | The 5R detail shows F, a refund-boat indicator and bet-type payout rows; official glossary states F/L refund semantics | Exact ticket selection/stake/refund adjudication, including invalid/cancelled and corrected cases | OBSERVABLE_ONLY |
| Source-controlled correction order | No source-issued revision sequence, predecessor/supersession ID or signed event order was identified on the reviewed pages | Whether such a feed exists outside these pages; fork/tie resolution | NOT_ESTABLISHED |
| Complete correction history | The pages display an outcome view, not an authenticated inclusive revision range | Proof that no omitted predecessor, late correction or source fork exists through a checkpoint | NOT_ESTABLISHED |
| Source finality | Results are published as results, and the glossary refers to waiting for race confirmation | Source-defined finality watermark, revocation/correction after confirmation, independently authenticated terminal checkpoint | NOT_ESTABLISHED |
| Independent trust/clock/revocation | Official-site attribution is visible | Independently provisioned issuer keys, signed inclusion/clock/revocation records and reviewed validity windows | NOT_ESTABLISHED |
| Download route | Official index links to a race-results download service | Download payload format, immutable versions, signatures, change logs, completeness, rights and correction policy | UNINSPECTED / DO_NOT_INFER |

**Absence of a field on these pages is not proof that no private, contracted or other official feed exists.** The narrower supported finding is that the **reviewed public pages do not furnish the v349 independently authenticated range/finality proof**. Do not substitute polling frequency, a local content hash, page update time, a downloadable file, or a self-selected key for the missing source capability.

## Concrete denial implications and falsifiers

- **Observed result + refund marker is not exact settlement:** require independently bound ticket type/selection/stake and refund/void disposition before evaluability. A refund-boat marker must not be collapsed into a losing bet.
- **Latest visible result is not complete revision lineage:** if a later correction or omitted predecessor is possible without an independently authenticated range checkpoint, return `UNRESOLVED_FINALITY` / `INCOMPLETE_REVISION_CHAIN`, not `independentAuthorityVerified=true`.
- **Download availability is not an attestation:** an archive with no verifiable source-issued version/order/checkpoint remains a snapshot, even if it matches the website.
- **Falsifier of this blocker:** independently review a provider-issued specification and real verifiable evidence for source-scoped revision IDs, authenticated monotonic ordering (or defined partial-order resolution), inclusion/completeness through a checkpoint, correction-after-final rules, clock/key/revocation, and exact ticket/refund binding. Until then, no positive verifier fixture or scoring branch.
- **Follow-up bounded audit:** examine the official race-results download service's public *documentation/metadata only* (format, update/correction/version policy and usage rights), or obtain a documented provider feed contract. Do not infer capabilities from raw results and do not connect any live feed to research/production automatically.

## Lineage, learning gate and disposition

Canonical main observed `2342494f6581c167a5648681ca7374b26d6659d4`; sole open research PR #2286, preceding head `12809adad3e44fef17d6dc818abccc9ff2802c05`. Read latest-main `docs/architecture/research-learning-loop.md` and `docs/architecture/research-knowledge-retention-contract.md`, v349 source-finality audit, v346 negative fixture contract, `LEARN-forward-v02-settlement-revision-anchor-window-20261024`, `LEARN-forward-v02-terminal-proof-ref-fixture-drift-20261024`, `LEARN-forward-v02-negative-catalog-first-denial-precedence-20261026`, `LEARN-forward-v02-negative-catalog-case-semantics-drift-20261026`, and `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2`. Reviewed merged PRs #2284 and #2285. The historical dataset discovery is **not** independently frozen prospective enrollment or finality evidence; no relevant substantive Rejection record was identified.

- `fingerprintKey=research-k3.forward-vault.v02-official-public-settlement-source-capability-review`
- `attemptSignature=pr2286-v350-read-only-official-public-result-refund-and-download-index-source-capability-comparison`
- `environmentKey=github-connector/public-official-web-read-only`
- `materialStateKey=forward-v02-pr2286-v349-no-independent-source-policy-or-authenticated-correction-checkpoint`
- Gate: `PROCEED_DISTINCT / REUSE_GUARDRAIL`; prior known failure mechanisms and first-denial/fixture guards reused, no blocked retry attempted.
- Classification: `REUSED_LEARNING`. This is a new **provider-surface evidence audit** that narrows the external dependency, not a new root-cause failure or verified success. No filler `LEARN-*` added.
- Latest pre-write PR CI #40262012913: verify and research-governance SUCCESS; no protected N2 diagnostic run. New report requires a separate latest-HEAD CI check.

**Result: public official result/refund presentation confirmed; independently authenticated revision completeness/finality remains unproven.** Remain `ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE`, `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`.

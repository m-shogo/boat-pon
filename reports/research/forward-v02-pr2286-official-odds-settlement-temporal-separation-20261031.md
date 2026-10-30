# Forward Vault v0.2 — first-party closing-odds versus final-settlement time semantics (2026-10-31 JST)

**Disposition: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** This is a bounded public-documentation audit, not a K-file read, an authenticated settlement revision, a rights grant, a model evaluation, a positive proof, or production authority. No protected N2, Current BUY, LINE, public publishing, automated betting, production settings/behavior, Owner Dashboard, raw private T-5 odds, secrets or private paths were accessed or modified.

## Distinct question and method

The prior v350–v352 official K/settlement audits and v483 derived-source audit establish that public result pages and downloadable-file navigation do **not** provide an authenticated complete K correction chain, rights grant or finality checkpoint. This review asks a narrower **temporal-semantics** question not resolved by a generic official-result attribution: can official displayed *closing odds* be treated as either the decision-time T-5 price or the final settlement multiplier, especially after start incidents/refunds?

Read only first-party, public explanatory text on 2026-10-31 JST; no odds tables, race payloads, downloads or private values were collected:

1. [Official site-about / update semantics](https://boatrace.jp/owsp/sp/extra/about.html): the site says odds require an explicit screen refresh; its **締切時オッズ** icon refers to sale-closing odds and **not** final confirmed odds, and it warns that start-incident effects are not reflected there.
2. [Official glossary — オッズ](https://www.boatrace.jp/owpc/pc/extra/enjoy/guide/jiten/05/y_028.html): before closing, odds are *estimated* returns; because purchases concentrate near cutoff, the price seen when purchasing need not equal the eventual return.
3. [Official closing-odds page explanation (拡連複)](https://boatrace.jp/owpc/pc/race/oddsk?hd=20260912&jcd=21&rno=2): the general explanatory note states closing odds reflect the completed sales-count aggregation, but **post-start refunds/withdrawals are not reflected**. Only the explanatory note was used; no displayed selection or price is retained in this report.
4. [Official refund glossary](https://www.boatrace.jp/owpc/pc/extra/enjoy/guide/jiten/29/y_250.html): refund rules depend on the event classification. A race-level marker cannot independently adjudicate a particular ticket.
5. [Official BOAT RACE site policy](https://www.boatrace.jp/owsp/sp/extra/policy.html): the site disclaims unconditional accuracy/freshness and does not grant a blanket license to reuse its content. The distinct K-host rights question remains unresolved; these terms are **not** transplanted to the K archive.

## Evidence-class separation and fail-closed consequences

| Distinct evidence object | What the official pages support | What must **not** be inferred |
| --- | --- | --- |
| Decision-time T-5 observed odds | A point-in-time quote can be recorded under its own capture-time/source lineage if independently admitted | A later closing-odds screen is **not** a substitute for missing T-5 capture, and cannot be backfilled as decision-time knowledge |
| Closing / sales-cutoff odds | A public display of aggregated sales-close odds, with source-documented exclusions | Not final confirmed odds, not an authenticated post-start refund-adjusted multiplier, not a source finality checkpoint |
| Official published race result / payout | A presentation of a race outcome and published payouts, subject to source/rights review | Not an authenticated complete revision history, nor automatically the exact settlement of each ticket |
| Ticket-level settlement | Requires exact decision/ticket/bet type/selection/stake and refund/void/cancellation disposition bound to a verified terminal revision | Never derive from a closing-odds quote or from a refund-boat indicator alone |
| K archive / third-party mirrors | Download navigation or a derived mirror may expose data for separately authorized review | Neither supplies K issuer rights, independent correction-range completeness or authenticated terminality by itself |

**Non-equivalence invariant:** `decision-time quote != closing display != post-incident adjusted price != exact ticket payout`. Even if numeric values happen to match in a particular case, equality does not establish provenance, point-in-time validity, revision completeness or rights. The official note is a source-specific reason to preserve the distinction, not a claim that every race has a refund or a changed payout.

## Practical research admission rules (documentation only)

- Keep the observed T-5 quote's timestamp, acquisition lineage and missingness as recorded; do not reconstruct it from closing odds or eventual payout. A missing decision-time quote remains **MISSING_PIT_EVIDENCE**, not a usable historical substitute.
- Keep `oddsBasis` / observation time distinct from `settlementBasis` / source revision and terminality. A displayed closing-odds label must not set `EXACT`, `FINAL`, `independentAuthorityVerified` or `scoringAuthorized`.
- Treat refunds, cancellations, voids and non-evaluable results as distinct from losses; require exact-ticket mapping and independent terminal revision proof before scoring.
- A source-issued, independently authenticated complete correction checkpoint and reviewed K rights would be necessary for a future separately approved verifier. A closing-odds page or nightly replacement does not meet this threshold.
- No schema, code, production configuration, data source, model, readiness count or evaluation cohort is changed by this report.

## Falsifier and future test

A future **rights-reviewed** issuer specification could supply a distinct authenticated post-start adjusted odds/payout object with exact-ticket identity and a complete source-issued correction range. Only independently verified evidence under a frozen, approved prospective protocol could permit a separately reviewed research scoring path. An appropriate **synthetic-only** future regression would demonstrate that substituting a closing display for missing T-5 evidence or a final payout is denied, while exact independent settlement evidence remains a separate admission gate. This is a proposed test, **not** an executed test or proof of any provider capability.

## Authority, lineage, learning gate

- Pre-write canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`; PR #2286 Draft/unmerged pre-write HEAD `3a7e4a6f4ad360274d751b4dc6aab1ea046cd7eb`; PR #2287 separately owns LINE. The latest PR-head [CI #41135335571](https://github.com/m-shogo/boat-pon/actions/runs/41135335571) was SUCCESS with both verify and research-governance jobs green; this predates the present report.
- Read latest-main `docs/architecture/research-learning-loop.md`, `docs/architecture/research-knowledge-retention-contract.md` and Forward Evaluation Vault architecture. Prior evidence: `forward-v02-official-settlement-source-capability-review-20261026.md`, `forward-v02-official-download-documentation-boundary-audit-20261026.md`, `forward-v02-provider-clarification-evidence-request-20261026.md`, and v483 derived-source audit. The provider clarification packet remains the **single** first-party K evidence-request authority; no duplicate outreach is proposed.
- Reused `LEARN-forward-v02-synthetic-reference-never-authority-20261025` (no caller/secondary-source proof promotion) and `LEARN-forward-v02-settlement-revision-anchor-window-20261024` (revision-wide settlement anchor validity). Existing `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2` are historical inventory, not frozen prospective eligibility. Recent merged #2284/#2285 are canonical research architecture; no substantive relevant Rejection was identified on main.
- `fingerprintKey=research-k3.forward-vault.official-closing-odds-versus-final-settlement-temporal-non-equivalence`
- `attemptSignature=pr2286-v484-first-party-about-glossary-and-closing-odds-explanatory-note-temporal-separation`
- `environmentKey=public-official-documentation-20261031/github-connector-research-draft`
- `materialStateKey=official-first-party-closing-odds-not-final-and-post-start-refunds-excluded/pr2286-no-K-terminal-attestation`
- Gate: `PROCEED_DISTINCT / REUSE_GUARDRAIL` — first-party **odds temporal semantics**, not another K landing-page text-extraction retry or third-party mirror rights review.
- Classification: `REUSED_LEARNING / NO_NEW_LEARNING`. This narrows a source-specific evaluation boundary; no new independently verified implementation success or technical root-cause failure merits a filler LEARN record.

**Decision unchanged:** `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`; do not merge, dispatch protected N2 or connect research to production. Next safe dependency: attributable K issuer rights and authenticated inclusive correction/finality evidence, then separately exact-ticket/refund proof, prospective cohort and protocol review.

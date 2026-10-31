# Forward Vault v0.2 — official TELEBOAT refund/void reporting-denominator semantics (2026-10-31 JST)

**Disposition: ENGINEERING_REQUIRED / DO_NOT_MERGE_CANDIDATE.** Public first-party *metric-definition* audit only. No ticket/account access, betting history, raw odds, K downloads, private values, provider contact, protected N2, production changes or scored evaluation. A public help page is not a K-source rights grant, authenticated settlement chain, independent terminality proof, or scoring approval.

## Distinct question and source evidence

The previous official closing-odds audit separates decision-time quotes from eventual payout; the earlier refund-evaluability Learning blocks REFUNDED from scored ROI under the current ledger. This audit instead asks: **Does the official consumer-facing TELEBOAT "回収率 / 的中率 / 購入レース数" reporting contract use the same denominator and outcome classes as a prospective Forward Vault evaluation?** The answer is **not established; the official presentation uses distinct metric populations that must not be silently imported into the research protocol**.

First-party public pages inspected 2026-10-31 JST (only definitions and non-private event/status examples):

1. [BOAT RACE official TELEBOAT 投票結果参照](https://www.boatrace.jp/owpc/pc/extra/tb/kinou/kekka.html), "集計データについて": the displayed **回収率** uses all purchase amount as denominator and total returned amount **including refunds and special payouts (特払い)** as numerator. It excludes all-refunded races due to cancellation/non-establishment from **購入レース数**, and excludes refund-only/special-payout-only events from **的中レース数**. The official example explicitly shows an all-refunded day with purchased-race count **0**, hit rate **0%**, yet return rate **100%**. These are consumer-reporting conventions, not independent proof of any individual ticket settlement.
2. [Official 鳴門 2021-12-17 result list](https://www.boatrace.jp/owpc/pc/race/resultlist?hd=20211217&jcd=14): on **5R**, the 3連勝単式 market is displayed **不成立**, while 2連勝単式 has a published winning combination/payout; on **12R**, both displayed markets are **レース中止**. This is a public *market-versus-race status* counterexample: do not infer that every ticket in a race shares a single ordinary win/loss or refund status. No prices, selections or personal tickets are reproduced here.
3. [Official 丸亀 2022-01-22 result list](https://www.boatrace.jp/owpc/pc/race/resultlist?hd=20220122&jcd=15): **5R** shows **不成立** for both listed markets with a **返還艇あり** note. This is an additional presentation example, **not** an authenticated ticket-level refund mapping or proof that all invalidity cases share one rule.
4. [Official refund glossary](https://www.boatrace.jp/owpc/pc/extra/enjoy/guide/jiten/29/y_250.html): a refund depends on the event and ticket circumstances; a race-level label does not establish an exact ticket's disposition.

## Four boundaries that a future frozen protocol must keep separate

| Question | First-party presentation supports | Forward Vault research admission requirement |
| --- | --- | --- |
| Return numerator | TELEBOAT 回収率 includes ordinary payout **plus refund and 特払い** | Freeze the research monetary numerator explicitly; never assume all return types are scored wins |
| Monetary denominator | TELEBOAT 回収率 divides by **all purchased amount**, including refunded stake | Declare gross purchase stake vs stake-at-risk and refunds separately, with a versioned formula |
| Race/hit count denominators | Fully refunded cancelled/non-established races are excluded from 購入レース数; refund-only and 特払い-only are not hits | Freeze purchased-race, eligible-race, included-decision, and scored-decision populations independently; preserve exclusions |
| Terminal status granularity | The same 5R may show a non-established trifecta market and a settled exacta market; cancellation is another visible state | Bind exact race + bet type + selection + stake + source-issued terminal revision; do not project one race-level marker onto all tickets |

**Counterexample to naïve metric transfer:** An all-refunded day can display TELEBOAT 回収率 100% while containing **zero scored wins** and zero purchased races in its displayed race-count convention. This is not evidence of model skill, profit, independent finality, or a Forward Vault ROI result. Likewise a 3連単 **不成立** label must not automatically void a separately published 2連単 settlement for the same race.

**Fail-closed implication:** Keep REFUNDED, VOID/cancelled, non-established market, 特払い, ordinary SETTLED and unresolved exact-ticket outcomes distinguishable in evidence and exclusion taxonomy. Do not infer exact payout or protocol evaluability from public result display or from TELEBOAT's presentation formula. Under the canonical Outcome Ledger, REFUNDED is non-evaluable for the current scoring boundary; the v0.1 Forward Vault protocol does not freeze all required formulas, monetary treatment, or denominators. A later v0.2 contract must explicitly resolve these choices **before** prospective evaluation; no live evaluator or production change is authorized here.

## Falsifier, limits and next safe test

A separately reviewed, source-attributable exact-ticket settlement specification (including market-level non-establishment, special payout, refund/void/cancellation and revision finality) plus an independently frozen v0.2 formula could justify **synthetic-only** negative fixtures: all-refund day 100%-display/zero-scored-win, mixed-market non-establishment within one race, and race-wide cancellation. The fixture should assert exclusion/accounting **without producing an ALLOW/scoring branch**. This report does not implement such a fixture or claim source completeness. Official consumer help does not establish K-host rights, complete corrections, cryptographic authenticity, or a verified issuer.

## Authority and learning gate

- Pre-write canonical main: `2342494f6581c167a5648681ca7374b26d6659d4`. PR #2286 Draft/unmerged at `2800d92c5abeb5b5e98676545d2989ba17a6c030`, 711 commits/388 research-scoped paths; PR #2287 is separate LINE ownership. Exact prior-head [CI #41142228130](https://github.com/m-shogo/boat-pon/actions/runs/41142228130) SUCCESS: 4,676 PASS / 2 SKIP / 0 FAIL; verify/governance full logs and post-job cleanup inspected. This CI **predates this report**.
- Read latest-main `docs/architecture/research-learning-loop.md`, `docs/architecture/research-knowledge-retention-contract.md`, Outcome Ledger and Forward Vault contracts; reviewed merged #2284/#2285, historical `EXP-dataset-expand-701398c2` / `DISC-dataset-coverage-701398c2`, and main Rejection inventory (only .gitkeep). Historical coverage is not a prospective freeze or K attestation.
- Reused `LEARN-forward-vault-refund-evaluability-contract-drift-20261018`, `LEARN-forward-vault-unresolved-vs-refund-policy-20261019`, `LEARN-forward-v02-excluded-settlement-evaluability-20261024`; and prior `reports/research/forward-vault-evaluation-protocol-contract-gate-20261022.md` and `forward-v02-pr2286-official-odds-settlement-temporal-separation-20261031.md`. No unchanged failed method was retried.
- `fingerprintKey=research-k3.forward-vault.official-teleboat-return-hit-rate-denominator-non-equivalence`
- `attemptSignature=pr2286-v485-first-party-teleboat-reporting-definitions-and-mixed-market-status-evidence-review`
- `environmentKey=public-first-party-teleboat-help-and-resultlist-20261031/github-connector-draft`
- `materialStateKey=teleboat-refunds-in-return-numerator-but-excluded-race-hit-counts+mixed-market-nonestablishment/pr2286-v01-no-frozen-monetary-protocol`
- Gate: **PROCEED_DISTINCT / REUSE_GUARDRAIL**. Classification: **REUSED_LEARNING / NO_NEW_LEARNING**; no new technical root-cause failure or non-obvious implementation success requiring a filler LEARN.

**Isolation:** `independentAuthorityVerified=false`, `scoringAuthorized=false`, `productionConnection=false`. No Current BUY, LINE, public publishing, automated betting, production settings/behavior, Owner Dashboard, protected N2, secrets or private raw T-5 values/paths changed. Keep Draft and do not merge pending K issuer/rights, authenticated inclusive correction/finality, exact settlement, prospective cohort and approved protocol.

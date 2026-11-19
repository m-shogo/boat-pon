# Research audit: legacy returned flag in growth accuracy population

Status: hypothesis only; **no measured impact, no readiness claim, no production change**.
Scope: read-only audit of `scripts/report-growth.ts` and canonical `docs/knowledge-base.md` as of main `54ae2c7c40e53f81983ecca496a6e915896bf9fd`.

## Observed code/data-contract mismatch

- `report-growth.ts` joins `race_results rr` and selects `rr.returned`; `isSettled(d)` requires `d.trifecta` and `d.payout` and `!d.returned`.
- `docs/knowledge-base.md` explicitly warns that `race_results.returned` is a legacy interpretation, including special-payout false positives and missing bet-specific flying-start refunds. The corrected `race_payouts` / `race_conditions` flags are not equivalent to this legacy column.
- The BUY ledger in the same report uses `settleTrifectaBuy` separately. **Do not substitute BUY settlement for accuracy-scoring eligibility without defining the target outcome and comparison cohort.**
- `comparedRaces` is `scored.length` (scored decision rows), not a count of unique race IDs.

## Safe next measurement (not yet executed)

On a **read-only** copy/connection, reproduce the canonical decision selection (paper-live, exact model version, inclusive report date bounds, ROW_NUMBER by race_id/bet_type/selection ordered by created_at DESC/id DESC). Join official results and the existing complete T-5 capture availability. For each report window, count distinct races and scored decisions separately. Stratify exclusions in order: missing official trifecta, missing payout, legacy returned flag, missing complete T-5, missing calibration/selection. In particular, count otherwise eligible rows excluded **only** by `rr.returned`. Do not claim that all such rows should be included: inspect official outcome semantics first.

For an eventual synthetic regression, distinguish (a) ordinary finished race with a special payout in an unrelated bet type, (b) actual trifecta-wide cancellation, and (c) bet-specific refund. Assert eligibility only after the official outcome rule is documented. Run `node --test` for the existing synthetic fixture before proposing any production change.

## Guardrails

No protected N2 activation, raw private T-5 data, private paths, DB writes, Current BUY, LINE, publishing, automated betting, production settings or logic. No sample counts or metric deltas are asserted. This note is a research audit plan, not evidence of improved logloss.

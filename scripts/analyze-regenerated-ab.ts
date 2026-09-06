/**
 * Fail-closed entrypoint for the regenerated historical A/B review.
 *
 * The legacy implementation regenerated candidate selections safely enough for
 * historical feature comparison, but it still used saved/current market odds
 * as realized return (`currentOdds * 100`) when computing ROI. That return
 * basis is not authoritative settlement and can distort model-pattern
 * conclusions.
 *
 * Keep this normal command disabled until realized returns are rebased to the
 * canonical official settlement in `race_payouts.payout_yen` with explicit
 * completeness checks for every evaluated BUY race.
 */

throw new Error(
  "REGENERATED_AB_OFFICIAL_PAYOUT_REQUIRED: quote-based ROI is disabled until analyze:regenerated-ab uses official race_payouts.payout_yen with complete settlement coverage for realized returns",
);

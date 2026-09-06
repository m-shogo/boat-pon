/**
 * Fail-closed entrypoint for historical ROI monthly-regime analysis.
 *
 * The legacy analyzer used saved/current market odds as realized returns and
 * then promoted those quote-based ROI values into monthly regime labels,
 * grades, PAPER/NO_BUY-style interpretations, and proxy-diagnosis conclusions.
 * Market quotes are not authoritative settlement.
 *
 * Keep the normal command disabled until realized returns are rebased to the
 * canonical official race_payouts.payout_yen settlement with explicit complete
 * settlement coverage for every evaluated historical BUY race.
 */

throw new Error(
  "ROI_MONTHLY_REGIME_OFFICIAL_PAYOUT_REQUIRED: quote-based monthly ROI/regime classification is disabled until analyze:roi-monthly-regime uses official race_payouts.payout_yen with complete settlement coverage for realized returns",
);

/**
 * Fail-closed entrypoint for the legacy ROI weak-pattern analyzer.
 *
 * The previous implementation converted saved `current_odds` into realized
 * return and used that quote-based ROI to classify historical conditions as
 * NO_BUY_CANDIDATE, PAPER_ONLY, DO_NOT_TOUCH, WATCH, or OK. Those research
 * labels must not be emitted until realized returns are rebased to canonical
 * official settlement.
 */

throw new Error(
  "ROI_WEAK_PATTERNS_OFFICIAL_PAYOUT_REQUIRED: quote-based weak-pattern classification is disabled until analyze:roi-weak-patterns uses official race_payouts.payout_yen",
);

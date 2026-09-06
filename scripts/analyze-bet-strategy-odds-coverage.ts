/**
 * Fail-closed entrypoint for the legacy bet-strategy odds coverage review.
 *
 * The previous implementation used saved/current market odds as realized
 * return for generated tickets, then propagated quote-based returns into ROI
 * and paper/adoption judgements. Those conclusions must not be emitted until
 * realized returns are rebased to canonical official settlement.
 */

throw new Error(
  "BET_STRATEGY_ODDS_COVERAGE_OFFICIAL_PAYOUT_REQUIRED: quote-based ROI/judgements are disabled until analyze:bet-strategy-odds-coverage uses official race_payouts.payout_yen for realized returns",
);

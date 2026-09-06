/**
 * Fail-closed entrypoint for the legacy bet-strategy ROI simulation.
 *
 * The previous implementation treated saved/current market odds as realized
 * payout for original and generated tickets, then used those quote-based
 * returns for ROI, split validation, conditional winners, and strategy
 * classifications. Those research conclusions must not be emitted until every
 * realized-return path is rebased to canonical official settlement.
 */

throw new Error(
  "BET_STRATEGIES_OFFICIAL_PAYOUT_REQUIRED: quote-based strategy ROI is disabled until analyze:bet-strategies uses official race_payouts.payout_yen for realized returns",
);

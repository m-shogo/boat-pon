/**
 * Fail-closed entrypoint for the legacy isBase risk-reduction analysis.
 *
 * The previous implementation treated saved `current_odds` as realized return
 * for ROI and bankroll drawdown, then used those quote-based metrics to emit
 * CUT_CANDIDATE / KEEP_STRONG / PAPER_ONLY classifications and exclusion
 * recommendations. Those research decisions must not be emitted until every
 * realized-return path is rebased to canonical official settlement.
 */

throw new Error(
  "ROI_ISBASE_RISK_OFFICIAL_PAYOUT_REQUIRED: quote-based cut and risk classifications are disabled until analyze:roi-isbase-risk uses official race_payouts.payout_yen",
);

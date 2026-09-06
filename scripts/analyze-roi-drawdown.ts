/**
 * Fail-closed entrypoint for the legacy ROI drawdown / operation analysis.
 *
 * The previous implementation treated saved `current_odds` as realized return
 * when building balance curves, drawdown, ROI, recommended bankroll, and
 * operation judgements such as OPERATION_OK / PAPER_ONLY / DO_NOT_SHIP.
 * Those operational research labels must not be emitted until realized return
 * is rebased to canonical official settlement.
 */

throw new Error(
  "ROI_DRAWDOWN_OFFICIAL_PAYOUT_REQUIRED: quote-based drawdown, bankroll, and operation judgement are disabled until analyze:roi-drawdown uses official race_payouts.payout_yen",
);

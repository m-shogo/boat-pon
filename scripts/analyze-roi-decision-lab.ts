/**
 * Fail-closed entrypoint for the legacy ROI Decision Lab.
 *
 * The preserved legacy implementation computes candidate ROI from saved
 * `current_odds`, even though the research authority defines official
 * `race_payouts.payout_yen` as the primary realized-return basis. It also
 * loads winning payouts without using them in its core `metric()` ranking.
 *
 * Keeping that implementation behind the normal command could therefore
 * promote/demote NO_BUY and BET_SELECTOR candidates using a known optimistic
 * quote-based metric. Do not silently run it.
 *
 * Historical implementation is retained only for forensic comparison at:
 * `scripts/analyze-roi-decision-lab-legacy-current-odds.ts`.
 */

throw new Error(
  "ROI_DECISION_LAB_OFFICIAL_PAYOUT_REQUIRED: legacy current_odds ROI ranking is disabled; use official-payout research paths until the Decision Lab metric is rebased to race_payouts.payout_yen",
);

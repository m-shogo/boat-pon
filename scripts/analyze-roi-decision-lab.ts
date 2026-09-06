/**
 * Fail-closed entrypoint for the legacy ROI Decision Lab.
 *
 * The previous implementation ranked candidates from saved `current_odds`
 * even though research authority defines official `race_payouts.payout_yen`
 * as the primary realized-return basis. Git history retains that implementation
 * for forensic comparison; the normal command must not silently use it.
 */

throw new Error(
  "ROI_DECISION_LAB_OFFICIAL_PAYOUT_REQUIRED: current_odds ROI ranking is disabled until Decision Lab is rebased to official race_payouts.payout_yen",
);

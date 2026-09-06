/**
 * Fail-closed entrypoint for the legacy ROI commit review.
 *
 * The previous implementation explicitly calculated realized ROI from saved
 * `current_odds` while excluding official `race_payouts.payout_yen`, then used
 * that quote-based return for NO_BUY candidates, app-settings proposals, and a
 * final judgement. Git history retains the legacy review for forensic use; the
 * normal command must not emit those decisions until rebased to official
 * settlement.
 */

throw new Error(
  "ROI_COMMIT_OFFICIAL_PAYOUT_REQUIRED: current_odds ROI review is disabled until analyze:roi-commit is rebased to official race_payouts.payout_yen",
);

/**
 * Fail-closed entrypoint for the legacy ROI improvement candidate analyzer.
 *
 * The previous implementation explicitly excluded `race_payouts.payout_yen`
 * from ROI calculation and treated saved `current_odds` as realized return.
 * That can rank/remove research candidates on quote-based returns rather than
 * official settlement. Git history retains the legacy analyzer for forensic
 * comparison; the normal command must not silently use it.
 */

throw new Error(
  "ROI_CANDIDATES_OFFICIAL_PAYOUT_REQUIRED: current_odds ROI ranking is disabled until analyze:roi-candidates is rebased to official race_payouts.payout_yen",
);

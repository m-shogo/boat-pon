/**
 * ROI combination-watch — fail-closed research entrypoint.
 *
 * The legacy implementation classified 2/3-dimension combinations using
 * hit * current_odds from paper_roi_candidates as realized ROI. Quoted odds
 * are not canonical settled return, so strong/watch/weak labels from that
 * metric are disabled until the analysis is rebased onto complete official
 * settlement with refund semantics.
 */

console.error(
  "ROI_COMBINATION_WATCH_OFFICIAL_PAYOUT_REQUIRED: combination-watch verdicts are disabled until realized returns are rebased to complete canonical official settlements."
);
process.exit(2);

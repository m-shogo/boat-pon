/**
 * ROI condition-watch report — fail-closed research entrypoint.
 *
 * The legacy implementation classified historical/forward groups from
 * paper_roi_candidates using hit * current_odds as if quoted odds were
 * realized return. That metric may remain useful as a market-price proxy,
 * but it is not an official settled ROI and must not drive strong/watch/weak
 * research verdicts.
 *
 * Re-enable only after the report has been rebased onto complete canonical
 * official settlement (payout_yen + refund semantics) for every consumed row.
 */

console.error(
  "ROI_CONDITION_WATCH_OFFICIAL_PAYOUT_REQUIRED: condition-watch verdicts are disabled until realized returns are rebased to complete canonical official settlements."
);
process.exit(2);

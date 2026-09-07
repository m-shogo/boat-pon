/**
 * ROI watchlist summary — fail-closed research entrypoint.
 *
 * Its input watchlist is transitively derived from legacy combination-watch
 * pseudo-ROI based on quoted current_odds. A downstream summary must not make
 * that stale metric look like validated monitoring evidence. Re-enable only
 * after the full source chain is rebased to complete canonical official
 * settlement with refund semantics.
 */

console.error(
  "ROI_WATCHLIST_SUMMARY_OFFICIAL_PAYOUT_REQUIRED: watchlist summary is disabled until its source chain uses complete canonical official settlements."
);
process.exit(2);

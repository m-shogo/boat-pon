/**
 * ROI watchlist — fail-closed research entrypoint.
 *
 * The committed watchlist input is derived from legacy combination-watch
 * output whose historical/forward ROI and strong/watch/weak patterns use
 * quoted current_odds rather than canonical realized settlement. Do not
 * recategorize stale or regenerated quote-based artifacts as clean/risk/
 * forward-priority research evidence.
 */

console.error(
  "ROI_WATCHLIST_OFFICIAL_PAYOUT_REQUIRED: watchlist generation is disabled until its combination source is rebased to complete canonical official settlements."
);
process.exit(2);

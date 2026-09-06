/**
 * Fail-closed entrypoint for historical ROI miss-pattern analysis.
 *
 * The legacy analyzer mixed saved/current market odds into realized-return
 * baselines while comparing alternate ticket outcomes and then used those
 * mixed-basis metrics to recommend which selector looked promising. Market
 * quotes are not authoritative settlement.
 *
 * Keep the normal command disabled until every realized-return leg is rebased
 * to canonical official race_payouts.payout_yen settlement with explicit
 * complete settlement coverage for every evaluated historical BUY race and
 * every compared ticket type.
 */

throw new Error(
  "ROI_MISS_PATTERNS_OFFICIAL_PAYOUT_REQUIRED: mixed quote/settlement selector analysis is disabled until analyze:roi-miss-patterns uses official race_payouts.payout_yen with complete settlement coverage for all realized returns",
);

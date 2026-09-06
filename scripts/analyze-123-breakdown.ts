/**
 * 1-2-3 historical-breakdown realized-return boundary.
 *
 * The legacy analyzer treated saved `current_odds` quotes as realized payouts for
 * the all-BUY baseline and the dominant 1-2-3 selection across odds bands,
 * exhibition, race number, weather, venue, and cross-condition breakdowns.
 * Those quote-based ROIs then drove `paper-forward候補` / exclusion-oriented
 * classifications intended to decide when to stop using 1-2-3.
 *
 * Keep the normal analyzer fail-closed until the full historical population is
 * rebased to canonical trifecta `race_payouts.payout_yen` and complete official
 * settlement coverage is verified before any ROI or candidate classification is
 * produced. `current_odds` may remain a pre-race conditioning feature only.
 */

export {};

const ERROR_CODE = "BREAKDOWN_123_OFFICIAL_PAYOUT_REQUIRED";

throw new Error(
  `${ERROR_CODE}: 1-2-3 ROI/candidate classification is disabled until realized returns use canonical trifecta race_payouts.payout_yen with complete official settlement coverage; current_odds may only define pre-race market-quote bands`,
);

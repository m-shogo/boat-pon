/**
 * Suminoe historical-breakdown realized-return boundary.
 *
 * The legacy analyzer treated saved `current_odds` quotes as realized payouts for
 * baseline, venue, odds-band, race-number, selection, exhibition, weather, course,
 * and cross-condition ROI. Those quote-based ROIs then drove labels such as
 * `paper-forward候補` and exclusion recommendations.
 *
 * Keep the normal analyzer fail-closed until the entire historical population is
 * rebased to canonical trifecta `race_payouts.payout_yen` and complete official
 * settlement coverage is verified before any ROI or candidate classification is
 * produced. Market odds may remain a conditioning feature, never realized return.
 */

export {};

const ERROR_CODE = "SUMINOE_BREAKDOWN_OFFICIAL_PAYOUT_REQUIRED";

throw new Error(
  `${ERROR_CODE}: Suminoe ROI/candidate classification is disabled until realized returns use canonical trifecta race_payouts.payout_yen with complete official settlement coverage; current_odds may only define market-quote bands`,
);

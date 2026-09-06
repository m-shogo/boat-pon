/**
 * Historical bad-condition ROI realized-return boundary.
 *
 * The legacy analyzer searched for additional "do not buy" conditions by using
 * saved `current_odds` quotes as realized payouts across baseline, odds band,
 * venue, race number, month, weather, exhibition, course, selection, and cross
 * analyses. Quote-based ROI can therefore manufacture or hide an exclusion
 * candidate even though the quote was never the authoritative settlement.
 *
 * Keep this normal entrypoint fail-closed until the full historical population is
 * rebased to canonical `race_payouts.payout_yen` for the selected trifecta and
 * complete official settlement coverage is verified before any ROI, delta, or
 * exclusion-candidate conclusion is produced. `current_odds` may remain a
 * pre-race conditioning feature only.
 */

export {};

const ERROR_CODE = "ROI_BAD_CONDITIONS_OFFICIAL_PAYOUT_REQUIRED";

throw new Error(
  `${ERROR_CODE}: bad-condition ROI/exclusion discovery is disabled until realized returns use canonical race_payouts.payout_yen with complete official settlement coverage; current_odds may only define pre-race market-quote conditions`,
);

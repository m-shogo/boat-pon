/**
 * Model validation realized-return boundary.
 *
 * Historical validation previously treated saved/current market odds as realized
 * returns when calculating split ROI, odds-band ROI, monthly ROI, EV-band ROI,
 * ROI confidence bounds, and edge/overfit interpretations. Market quotes are not
 * authoritative settlement and therefore cannot support those conclusions.
 *
 * Keep this normal entrypoint fail-closed until the validator is rebased to
 * canonical race_payouts.payout_yen with complete official settlement coverage
 * for every historical BUY race included in any realized-return metric.
 * Calibration-only work that does not depend on realized returns should be split
 * into a separate explicitly scoped analyzer rather than weakening this guard.
 */

const ERROR_CODE = "MODEL_VALIDATION_OFFICIAL_PAYOUT_REQUIRED";

throw new Error(
  `${ERROR_CODE}: realized-return model validation is disabled until all ROI, confidence, edge, and overfit conclusions use canonical race_payouts.payout_yen with complete official settlement coverage; current_odds may be used only as a market-quote feature, never as realized return`,
);

/**
 * V4 historical evaluation realized-return boundary.
 *
 * The legacy read-only evaluator generated model BUY/WATCH/SKIP candidates and
 * summarized ROI/roiExMax from saved market quotes (`current_odds`). Those quotes
 * are useful pre-race features but are not authoritative realized settlement.
 * The same command also compared historical decision rows with quote-based ROI,
 * so its output could make the rejected/retained model comparison look stronger
 * or weaker for the wrong reason.
 *
 * Keep the normal `evaluate:v4` entrypoint fail-closed until all realized-return
 * metrics are rebased to canonical `race_payouts.payout_yen` and every historical
 * race contributing to ROI/roiExMax has complete official settlement coverage.
 * Market odds may remain inputs to the pre-race decision simulation only after
 * realized-return reporting is independently settlement-safe.
 */

const ERROR_CODE = "V4_EVALUATION_OFFICIAL_PAYOUT_REQUIRED";

throw new Error(
  `${ERROR_CODE}: evaluate:v4 realized-return metrics are disabled until ROI and roiExMax use canonical race_payouts.payout_yen with complete official settlement coverage; current_odds may remain a pre-race market feature but must not be treated as realized return`,
);

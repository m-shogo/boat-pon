import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-venue-monthly.ts", "utf-8");

test("venue monthly ROI uses official settlement payouts rather than current_odds returns", () => {
  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /rp\.bet_type = decision_history\.bet_type/);
  assert.match(source, /rp\.combination = decision_history\.selection/);
  assert.doesNotMatch(source, /THEN current_odds ELSE 0 END AS payout_odds/);
});

test("venue monthly ROI is unavailable when a winning settlement payout is missing", () => {
  const missingCount = source.indexOf("missing_payout_hits");
  const roiGuard = source.indexOf("CASE WHEN missing_payout_hits = 0");
  const roiOutput = source.indexOf("END AS roi,");

  assert.ok(missingCount >= 0, "missing official payout hits must be counted");
  assert.ok(roiGuard > missingCount, "ROI must be gated on complete winning-payout coverage");
  assert.ok(roiOutput > roiGuard, "ROI output must remain downstream of the completeness gate");
  assert.match(source, /ELSE NULL\s+END AS roi/);
  assert.match(source, /ELSE NULL\s+END AS roiExMax/);
});

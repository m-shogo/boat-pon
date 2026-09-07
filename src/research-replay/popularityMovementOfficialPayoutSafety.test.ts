import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-popularity-movement.ts", "utf8");

test("popularity movement report fails closed on ambiguous official winning settlements", () => {
  assert.match(source, /function assertOfficialSettlementIntegrity/u);
  assert.match(source, /SELECT DISTINCT dh\.race_id, dh\.bet_type, dh\.selection/u);
  assert.match(source, /dh\.returned = 0/u);
  assert.match(source, /dh\.selection = dh\.result/u);
  assert.match(source, /\) != 1[\s\S]*OR \([\s\S]*\) != 1/u);
  assert.match(source, /rp\.returned = 0/u);
  assert.match(source, /rp\.payout_yen IS NOT NULL/u);
  assert.match(source, /rp\.payout_yen > 0/u);
  assert.match(source, /POPULARITY_MOVEMENT_REPORT_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/u);
});

test("popularity movement ROI uses official payout units while checkpoint odds remain observational", () => {
  assert.match(source, /rp\.payout_yen \/ 100\.0/u);
  assert.match(source, /rp\.bet_type = dh\.bet_type/u);
  assert.match(source, /rp\.combination = dh\.selection/u);
  assert.match(source, /SUM\(payout_units\)/u);
  assert.match(source, /roiSource: "official race_payouts\.payout_yen"/u);
  assert.match(source, /checkpoint_label IN \('T-30', 'T-5'\)/u);
  assert.doesNotMatch(source, /CASE WHEN dh\.selection = dh\.result AND dh\.returned = 0 THEN dh\.current_odds ELSE 0 END/u);
});

test("popularity movement report uses canonical read-only database boundaries without path leakage", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile/u);
  assert.match(source, /new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only\s*=\s*ON/u);
  assert.match(source, /POPULARITY_MOVEMENT_REPORT_DB_MISSING/u);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/u);
});

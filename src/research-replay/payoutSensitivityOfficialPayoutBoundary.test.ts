import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-payout-sensitivity.ts", "utf8");

test("payout sensitivity uses exact positive non-refund official settlements", () => {
  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /rp\.bet_type = decision_history\.bet_type/);
  assert.match(source, /rp\.combination = decision_history\.selection/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
});

test("payout sensitivity fails closed on ambiguous winning settlement keys before ranking ROI", () => {
  assert.match(source, /function assertOfficialSettlementIntegrity\(\)/);
  assert.match(source, /SELECT DISTINCT race_id, bet_type, selection/);
  assert.match(source, /selection = result/);
  assert.match(source, /returned = 0/);
  assert.match(source, /SELECT COUNT\(\*\)[\s\S]*rp\.combination = h\.selection/);
  assert.match(source, /\) != 1/);
  assert.match(source, /PAYOUT_SENSITIVITY_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);

  const integrity = source.indexOf("assertOfficialSettlementIntegrity();");
  const query = source.indexOf("const rows = queryRows();");
  assert.ok(integrity >= 0 && query > integrity);
});

test("payout sensitivity keeps database access canonical and query-only", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

test("payout sensitivity preserves missing-payout nulling as a secondary fail-closed guard", () => {
  assert.match(source, /missing_payout_hits/);
  assert.match(source, /CASE WHEN g\.missing_payout_hits > 0 THEN NULL ELSE ROUND\(g\.total_payout_odds/);
  assert.match(source, /AS roiExTop1/);
  assert.match(source, /AS roiExTop3/);
  assert.match(source, /AS roiExTop5/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("data quality outcomes report verifies primary database identity before opening read-only", () => {
  const source = readFileSync("scripts/report-data-quality-outcomes.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /DATA_QUALITY_OUTCOMES_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /DATA_QUALITY_OUTCOMES_PRIMARY_DB_MISSING/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

test("data quality outcomes report keeps ROI denominators restricted to settled non-returned rows", () => {
  const source = readFileSync("scripts/report-data-quality-outcomes.ts", "utf8");

  assert.match(source, /SUM\(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END\) AS settled/);
  assert.match(source, /SUM\(CASE WHEN selection = result AND returned = 0 THEN 1 ELSE 0 END\) AS hits/);
  assert.match(source, /NULLIF\(settled, 0\)/);
});

test("data quality outcomes validates every settled denominator against exact official payouts before ROI", () => {
  const source = readFileSync("scripts/report-data-quality-outcomes.ts", "utf8");

  assert.match(source, /DATA_QUALITY_OUTCOMES_BET_TYPE_MAPPING_FAILED/);
  assert.match(source, /DATA_QUALITY_OUTCOMES_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
  assert.match(source, /WITH relevant_settled AS/);
  assert.match(source, /AND result IS NOT NULL/);
  assert.match(source, /AND result != ''/);
  assert.match(source, /AND returned = 0/);
  assert.doesNotMatch(source, /relevant_hits AS/);
  assert.match(source, /WHEN '3連単' THEN 'trifecta'/);
  assert.match(source, /WHEN '3連複' THEN 'trio'/);
  assert.match(source, /WHEN '2連単' THEN 'exacta'/);
  assert.match(source, /WHEN '2連複' THEN 'quinella'/);
  assert.match(source, /WHEN '拡連複' THEN 'wide'/);
  assert.match(source, /SELECT DISTINCT[\s\S]*payout_bet_type,[\s\S]*result/);
  assert.match(source, /s\.payout_bet_type IS NULL/);
  assert.match(source, /rp\.bet_type = s\.payout_bet_type/);
  assert.match(source, /rp\.combination = s\.result/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /rp\.combination = decision_history\.selection/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /SUM\(payout_units\) AS total_payout_units/);
  assert.doesNotMatch(source, /THEN current_odds ELSE 0 END AS payout_odds/);
});

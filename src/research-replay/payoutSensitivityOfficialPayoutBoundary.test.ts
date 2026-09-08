import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-payout-sensitivity.ts", "utf8");

function functionBody(name: string, nextName: string): string {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `expected ${name} before ${nextName}`);
  return source.slice(start, end);
}

test("payout sensitivity uses mapped exact positive non-refund official settlements", () => {
  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /WHEN '3連単' THEN 'trifecta'/);
  assert.match(source, /WHEN '3連複' THEN 'trio'/);
  assert.match(source, /WHEN '2連単' THEN 'exacta'/);
  assert.match(source, /WHEN '2連複' THEN 'quinella'/);
  assert.match(source, /WHEN '拡連複' THEN 'wide'/);
  assert.match(source, /rp\.bet_type = \$\{payoutBetTypeSql\("decision_history\.bet_type"\)\}/);
  assert.match(source, /rp\.combination = decision_history\.selection/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen IS NOT NULL/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.doesNotMatch(source, /rp\.bet_type = decision_history\.bet_type/);
});

test("payout sensitivity rejects unsupported bet types across the full report population before ROI", () => {
  assert.match(source, /function assertSupportedBetTypeMapping\(\)/);
  assert.match(source, /PAYOUT_SENSITIVITY_BET_TYPE_MAPPING_FAILED/);
  assert.match(source, /\(\$\{payoutBetTypeSql\("bet_type"\)\}\) IS NULL/);

  const mapping = source.indexOf("assertSupportedBetTypeMapping();");
  const integrity = source.indexOf("assertOfficialSettlementIntegrity();");
  const query = source.indexOf("const rows = queryRows();");
  assert.ok(mapping >= 0 && integrity > mapping && query > integrity);
});

test("payout sensitivity requires complete official settlements for every non-empty settled denominator row before ranking ROI", () => {
  const guard = functionBody("assertOfficialSettlementIntegrity", "queryRows");
  const queryBody = functionBody("queryRows", "groupByExpr");
  const integrity = source.indexOf("assertOfficialSettlementIntegrity();");
  const query = source.indexOf("const rows = queryRows();");

  assert.ok(integrity >= 0 && query > integrity);
  assert.match(guard, /WITH relevant_settled AS/);
  assert.match(guard, /SELECT DISTINCT[\s\S]*payout_bet_type,[\s\S]*result/);
  assert.match(guard, /result IS NOT NULL/);
  assert.match(guard, /result != ''/);
  assert.match(guard, /returned = 0/);
  assert.doesNotMatch(guard, /selection = result/);
  assert.match(guard, /s\.payout_bet_type IS NULL/);
  assert.match(guard, /rp\.bet_type = s\.payout_bet_type/);
  assert.match(guard, /rp\.combination = s\.result/);
  assert.match(guard, /rp\.returned = 0/);
  assert.match(guard, /rp\.payout_yen IS NOT NULL/);
  assert.match(guard, /rp\.payout_yen > 0/);
  assert.match(guard, /PAYOUT_SENSITIVITY_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);

  assert.match(queryBody, /SUM\(CASE WHEN result IS NOT NULL AND result != '' AND returned = 0 THEN 1 ELSE 0 END\) AS settled/);
  assert.match(queryBody, /SUM\(CASE WHEN result IS NOT NULL AND result != '' AND selection = result AND returned = 0 THEN 1 ELSE 0 END\) AS hits/);
  assert.match(queryBody, /SUM\(CASE WHEN result IS NOT NULL AND result != '' AND selection = result AND returned = 0 AND payout_odds IS NULL THEN 1 ELSE 0 END\) AS missing_payout_hits/);
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

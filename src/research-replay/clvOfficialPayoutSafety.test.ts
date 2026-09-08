import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-clv.ts", "utf8");

function functionBody(name: string, nextName: string): string {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `expected ${name} before ${nextName}`);
  return source.slice(start, end);
}

test("CLV report rejects unsupported bet types across the full report population before CLV/ROI aggregation", () => {
  assert.match(source, /function assertSupportedBetTypeMapping/u);
  assert.match(source, /CLV_REPORT_BET_TYPE_MAPPING_FAILED/u);
  assert.match(source, /\(\$\{payoutBetTypeSql\("dh\.bet_type"\)\}\) IS NULL/u);

  const mapping = source.indexOf("assertSupportedBetTypeMapping();");
  const settlement = source.indexOf("assertOfficialSettlementIntegrity();");
  const query = source.indexOf("const rows = queryRows();");
  assert.ok(mapping >= 0 && settlement > mapping && query > settlement);
});

test("CLV report requires complete canonical official winning settlement for every settled denominator row", () => {
  const settlementGuard = functionBody("assertOfficialSettlementIntegrity", "queryRows");

  assert.match(settlementGuard, /WITH relevant_settled AS/u);
  assert.match(settlementGuard, /SELECT DISTINCT[\s\S]*payout_bet_type,[\s\S]*dh\.result/u);
  assert.match(settlementGuard, /dh\.result IS NOT NULL/u);
  assert.match(settlementGuard, /dh\.result != ''/u);
  assert.match(settlementGuard, /dh\.returned = 0/u);
  assert.doesNotMatch(settlementGuard, /relevant_hits/u);
  assert.doesNotMatch(settlementGuard, /dh\.selection = dh\.result/u);
  assert.match(settlementGuard, /s\.payout_bet_type IS NULL/u);
  assert.match(settlementGuard, /rp\.bet_type = s\.payout_bet_type/u);
  assert.match(settlementGuard, /rp\.combination = s\.result/u);
  assert.match(settlementGuard, /\) != 1[\s\S]*OR \([\s\S]*\) != 1/u);
  assert.match(settlementGuard, /rp\.returned = 0/u);
  assert.match(settlementGuard, /rp\.payout_yen > 0/u);
  assert.match(settlementGuard, /CLV_REPORT_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/u);
  assert.doesNotMatch(settlementGuard, /rp\.bet_type = s\.bet_type/u);

  assert.match(source, /WHEN '3連単' THEN 'trifecta'/u);
  assert.match(source, /WHEN '3連複' THEN 'trio'/u);
  assert.match(source, /WHEN '2連単' THEN 'exacta'/u);
  assert.match(source, /WHEN '2連複' THEN 'quinella'/u);
  assert.match(source, /WHEN '拡連複' THEN 'wide'/u);
});

test("CLV report ROI uses mapped official payout units", () => {
  assert.match(source, /rp\.payout_yen \/ 100\.0/u);
  assert.match(source, /rp\.bet_type = \$\{payoutBetTypeSql\("dh\.bet_type"\)\}/u);
  assert.match(source, /rp\.combination = dh\.selection/u);
  assert.match(source, /SUM\(payout_units\)/u);
  assert.match(source, /roiSource: "official race_payouts\.payout_yen"/u);
  assert.doesNotMatch(source, /rp\.bet_type = dh\.bet_type/u);
  assert.doesNotMatch(source, /SUM\(CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END\)/u);
});

test("CLV report keeps aggregate checkpoint odds while hiding configured DB paths", () => {
  assert.match(source, /checkpoint_label IN \('T-30', 'T-20', 'T-10', 'T-5'\)/u);
  assert.match(source, /ROUND\(AVG\(t5\), 2\) AS avgT5/u);
  assert.match(source, /CLV_REPORT_DB_MISSING/u);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/u);
  assert.match(source, /new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only\s*=\s*ON/u);
});

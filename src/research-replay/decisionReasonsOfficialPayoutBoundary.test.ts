import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-decision-reasons.ts", "utf8");

function functionBody(name: string, nextName: string): string {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `expected ${name} before ${nextName}`);
  return source.slice(start, end);
}

test("decision reasons report uses verified read-only canonical DB", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

test("decision reasons ROI maps decision bet types to official payout namespaces", () => {
  assert.match(source, /function payoutBetTypeSql/);
  assert.match(source, /WHEN '3連単' THEN 'trifecta'/);
  assert.match(source, /WHEN '3連複' THEN 'trio'/);
  assert.match(source, /WHEN '2連単' THEN 'exacta'/);
  assert.match(source, /WHEN '2連複' THEN 'quinella'/);
  assert.match(source, /WHEN '拡連複' THEN 'wide'/);
  assert.match(source, /rp\.race_id = dh\.race_id/);
  assert.match(source, /rp\.bet_type = \$\{payoutBetTypeSql\("dh\.bet_type"\)\}/);
  assert.match(source, /rp\.combination = dh\.selection/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /metricBasis: "official_payout_yen"/);
  assert.match(source, /AVG\(current_odds\)/);
  assert.doesNotMatch(source, /rp\.bet_type = dh\.bet_type/);
  assert.doesNotMatch(source, /selection = result AND returned = 0 THEN current_odds/);
});

test("decision reasons settlement gate covers every non-empty settled denominator row", () => {
  const gate = functionBody("assertOfficialSettlementIntegrity", "queryRows");
  const query = functionBody("queryRows", "printRows");

  assert.match(source, /function reportScope\(\): QueryScope/);
  assert.match(gate, /JOIN json_each\(CASE[\s\S]*json_valid\(dh\.decision_reasons\)/);
  assert.match(gate, /WITH relevant_settled AS/);
  assert.match(gate, /SELECT DISTINCT[\s\S]*payout_bet_type,[\s\S]*dh\.result/);
  assert.match(gate, /dh\.result IS NOT NULL/);
  assert.match(gate, /dh\.result != ''/);
  assert.match(gate, /dh\.returned = 0/);
  assert.doesNotMatch(gate, /dh\.selection = dh\.result/);
  assert.match(gate, /s\.payout_bet_type IS NULL/);
  assert.match(gate, /rp\.bet_type = s\.payout_bet_type/);
  assert.match(gate, /rp\.combination = s\.result/);
  assert.match(gate, /rp\.returned = 0/);
  assert.match(gate, /rp\.payout_yen IS NOT NULL/);
  assert.match(gate, /rp\.payout_yen > 0/);
  assert.match(gate, /DECISION_REASONS_REPORT_SETTLEMENT_INTEGRITY_INVALID/);
  assert.doesNotMatch(gate, /rp\.bet_type = s\.bet_type/);

  assert.match(query, /SUM\(CASE WHEN result IS NOT NULL AND result != '' AND returned = 0 THEN 1 ELSE 0 END\) AS settled/);
  assert.match(query, /NULLIF\(SUM\(CASE WHEN result IS NOT NULL AND result != '' AND returned = 0 THEN 1 ELSE 0 END\), 0\)/);
});

test("decision reasons validates settlements before producing grouped ROI", () => {
  const gate = source.indexOf("assertOfficialSettlementIntegrity();");
  const query = source.indexOf("const rows = queryRows();");
  assert.ok(gate >= 0 && query > gate);
});

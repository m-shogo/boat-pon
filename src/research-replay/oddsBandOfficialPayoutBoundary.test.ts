import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-odds-band-outcomes.ts", "utf-8");

function functionBody(name: string, nextName: string): string {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `expected ${name} before ${nextName}`);
  return source.slice(start, end);
}

test("odds-band outcomes verifies the research DB before read-only SQLite open", () => {
  const verify = source.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0);
  assert.ok(open > verify);
  assert.match(source, /PRAGMA query_only = ON/);
});

test("odds-band ROI uses a mapped exact positive non-refund official settlement", () => {
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
  assert.doesNotMatch(source, /THEN current_odds ELSE 0 END AS payout_odds/);
  assert.match(source, /missing_payout_hits AS missingPayoutHits/);
  assert.match(source, /CASE WHEN missing_payout_hits = 0[\s\S]*?ELSE NULL[\s\S]*?END AS roi/);
  assert.match(source, /CASE WHEN missing_payout_hits = 0[\s\S]*?ELSE NULL[\s\S]*?END AS roiExMax/);
});

test("odds-band outcomes rejects unsupported bet types across the full report population before band ROI", () => {
  assert.match(source, /function assertSupportedBetTypeMapping\(\)/);
  assert.match(source, /ODDS_BAND_BET_TYPE_MAPPING_FAILED/);
  assert.match(source, /\(\$\{payoutBetTypeSql\("bet_type"\)\}\) IS NULL/);

  const mapping = source.indexOf("assertSupportedBetTypeMapping();");
  const integrity = source.indexOf("assertOfficialSettlementIntegrity();");
  const rows = source.indexOf("const rows = [");
  assert.ok(mapping >= 0 && integrity > mapping && rows > integrity);
});

test("odds-band outcomes fails closed on every non-empty settled denominator settlement before band ROI", () => {
  const guard = functionBody("assertOfficialSettlementIntegrity", "queryMetric");
  const query = functionBody("queryMetric", "oddsBandSql");

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
  assert.match(guard, /ODDS_BAND_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);

  assert.match(query, /SUM\(CASE WHEN result IS NOT NULL AND result != '' AND returned = 0 THEN 1 ELSE 0 END\) AS settled/);
  assert.match(query, /SUM\(CASE WHEN result IS NOT NULL AND result != '' AND selection = result AND returned = 0 THEN 1 ELSE 0 END\) AS hits/);
  assert.match(query, /SUM\(CASE WHEN result IS NOT NULL AND result != '' AND selection = result AND returned = 0 AND payout_units IS NULL THEN 1 ELSE 0 END\) AS missing_payout_hits/);

  const integrity = source.indexOf("assertOfficialSettlementIntegrity();");
  const rows = source.indexOf("const rows = [");
  assert.ok(integrity >= 0 && rows > integrity);
});

test("odds-band missing-file failure does not disclose the configured database path", () => {
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

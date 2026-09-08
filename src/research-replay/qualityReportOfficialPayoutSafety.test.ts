import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-quality.ts", "utf8");

test("quality report computes ROI from mapped canonical official payouts, not decision-time odds", () => {
  assert.match(source, /function payoutBetTypeSql/u);
  assert.match(source, /WHEN '3連単' THEN 'trifecta'/u);
  assert.match(source, /official_payout_yen/u);
  assert.match(source, /race_payouts rp/u);
  assert.match(source, /Number\(r\.official_payout_yen \?\? 0\) \/ 100/u);
  assert.doesNotMatch(source, /hits\.reduce\(\(sum, r\) => sum \+ \(r\.current_odds \?\? 0\)/u);
  assert.match(source, /roiSource: official race_payouts\.payout_yen/u);
});

test("quality report fails closed before aggregation when a settled BUY has unsupported mapping or an invalid winning settlement", () => {
  assert.match(source, /function assertOfficialSettlementIntegrity/u);
  assert.match(source, /QUALITY_REPORT_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/u);
  assert.match(source, /s\.payout_bet_type IS NULL/u);
  assert.match(source, /s\.selection = s\.result/u);
  assert.match(source, /rp\.returned = 0/u);
  assert.match(source, /rp\.payout_yen IS NOT NULL/u);
  assert.match(source, /rp\.payout_yen > 0/u);

  const guard = source.indexOf("assertOfficialSettlementIntegrity(db, from, to);");
  const query = source.indexOf("const rows = listRows(db, from, to);");
  assert.ok(guard >= 0 && query > guard);
});

test("quality report does not expose the configured database path when the primary database is missing", () => {
  assert.match(source, /QUALITY_REPORT_DB_MISSING/u);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/u);
});

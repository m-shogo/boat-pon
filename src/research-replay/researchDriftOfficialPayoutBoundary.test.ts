import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/detect-research-drift.ts", "utf8");

test("research drift uses canonical mapped official payouts for realized ROI", () => {
  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /WHEN '3連単' THEN 'trifecta'/);
  assert.match(source, /WHEN '3連複' THEN 'trio'/);
  assert.match(source, /WHEN '2連単' THEN 'exacta'/);
  assert.match(source, /WHEN '2連複' THEN 'quinella'/);
  assert.match(source, /WHEN '拡連複' THEN 'wide'/);
  assert.match(source, /rp\.combination = dh\.selection/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen IS NOT NULL/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /payoutYen: row\.official_payout_yen/);
  assert.doesNotMatch(source, /payoutYen: row\.payout_yen/);
});

test("research drift fails closed before aggregation on unsupported or ambiguous winning settlements", () => {
  const integrityCall = source.indexOf("assertOfficialSettlementIntegrity(db, from, to)");
  const query = source.indexOf("const raw = db.prepare", integrityCall);

  assert.ok(integrityCall >= 0 && query > integrityCall, "expected settlement preflight before row aggregation");
  assert.match(source, /s\.payout_bet_type IS NULL/);
  assert.match(source, /SELECT COUNT\(\*\)[\s\S]*FROM race_payouts rp/);
  assert.match(source, /RESEARCH_DRIFT_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
});

test("research drift keeps database access read-only and does not expose configured missing path", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.match(source, /research database not found; produced empty evaluation/);
  assert.doesNotMatch(source, /db not found at \$\{DB_PATH\}/);
});

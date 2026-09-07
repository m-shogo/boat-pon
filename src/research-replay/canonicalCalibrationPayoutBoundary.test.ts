import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("canonical calibration remains research-only and uses the fixed BUY population", () => {
  const source = readFileSync("scripts/analyze-canonical-calibration.ts", "utf8");
  assert.match(source, /decision='BUY'/);
  assert.match(source, /run_kind='historical-backfill'/);
  assert.match(source, /model_version=\?/);
  assert.match(source, /bet_type='3連単'/);
  assert.match(source, /returned=0/);
});

test("canonical calibration uses exactly one positive official trifecta settlement for every winning row", () => {
  const source = readFileSync("scripts/analyze-canonical-calibration.ts", "utf8");
  assert.match(source, /assertOfficialSettlementIntegrity\(\);/);
  assert.match(source, /CANONICAL_CALIBRATION_OFFICIAL_SETTLEMENT_INVALID/);
  assert.match(source, /rp\.bet_type='trifecta'/);
  assert.match(source, /rp\.combination=w\.selection/);
  assert.match(source, /total_rows != 1 \|\| valid_rows != 1/);
  assert.match(source, /rp\.combination=decision_history\.selection/);
  assert.match(source, /rp\.returned=0/);
  assert.match(source, /rp\.payout_yen>0/);
  assert.match(source, /payoutBasis: "race_payouts\.payout_yen \/ 100円 \(official trifecta settlement\)"/);
  assert.doesNotMatch(source, /payoutBasis: "decision_history\.payout_yen/);
  const integrityCheck = source.indexOf("assertOfficialSettlementIntegrity();");
  const rowQuery = source.indexOf("const rows = db.prepare(`");
  assert.ok(integrityCheck >= 0 && rowQuery > integrityCheck);
});

test("canonical calibration fails closed on DB identity and missing hit payouts", () => {
  const source = readFileSync("scripts/analyze-canonical-calibration.ts", "utf8");
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertPayoutCompleteness\(rows\);/);
  assert.match(source, /CANONICAL_CALIBRATION_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /value\.total <= 0 \|\| value\.hits <= 0/);
  assert.match(source, /value\.paidHits !== value\.hits/);
  assert.match(source, /requiredHitPayout\(row\)/);
  assert.match(source, /CANONICAL_CALIBRATION_HIT_PAYOUT_MISSING/);
  assert.doesNotMatch(source, /r\.payout_yen \?\? 0/);
});

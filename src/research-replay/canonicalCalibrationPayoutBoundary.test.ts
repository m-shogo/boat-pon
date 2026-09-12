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

test("canonical calibration rejects blank historical BUY results before return-state and settlement analysis", () => {
  const source = readFileSync("scripts/analyze-canonical-calibration.ts", "utf8");
  assert.match(source, /assertNonblankResultIntegrity\(\);/);
  assert.match(source, /TRIM\(result\)=''/);
  assert.match(source, /CANONICAL_CALIBRATION_BLANK_SETTLED_RESULT_UNSUPPORTED/);
  assert.match(source, /AND result IS NOT NULL AND TRIM\(result\)!=''/);

  const blankGate = source.indexOf("assertNonblankResultIntegrity();");
  const returnGate = source.indexOf("assertReturnStateIntegrity();");
  const settlementGate = source.indexOf("assertOfficialSettlementIntegrity();");
  const rowQuery = source.indexOf("const rows = db.prepare(`");
  assert.ok(blankGate >= 0);
  assert.ok(returnGate > blankGate);
  assert.ok(settlementGate > returnGate);
  assert.ok(rowQuery > settlementGate);
});

test("canonical calibration rejects unknown or returned BUY rows before settlement and row loading", () => {
  const source = readFileSync("scripts/analyze-canonical-calibration.ts", "utf8");
  assert.match(source, /returned IS NULL OR returned != 0/);
  assert.match(source, /CANONICAL_CALIBRATION_RETURN_STATE_INVALID/);
  const returnGate = source.indexOf("assertReturnStateIntegrity();");
  const settlementGate = source.indexOf("assertOfficialSettlementIntegrity();");
  const rowQuery = source.indexOf("const rows = db.prepare(`");
  assert.ok(returnGate >= 0);
  assert.ok(settlementGate > returnGate);
  assert.ok(rowQuery > settlementGate);
});

test("canonical calibration uses exactly one positive official trifecta settlement for every winning row", () => {
  const source = readFileSync("scripts/analyze-canonical-calibration.ts", "utf8");
  assert.match(source, /assertOfficialSettlementIntegrity\(\);/);
  assert.match(source, /CANONICAL_CALIBRATION_OFFICIAL_SETTLEMENT_INVALID/);
  assert.match(source, /rp\.bet_type='trifecta'/);
  assert.match(source, /rp\.combination=w\.selection/);
  assert.match(source, /total_rows != 1 OR valid_rows != 1/);
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

test("canonical calibration validates existing reports and revalidates destinations before atomic replacement", () => {
  const source = readFileSync("scripts/analyze-canonical-calibration.ts", "utf8");
  const preflightJson = source.indexOf("verifyExistingOutput(OUT_JSON");
  const preflightMd = source.indexOf("verifyExistingOutput(OUT_MD");
  const jsonPublish = source.indexOf("atomicPublish(\n    OUT_JSON");
  const mdPublish = source.indexOf("atomicPublish(\n    OUT_MD");
  assert.ok(preflightJson >= 0 && preflightMd > preflightJson && jsonPublish > preflightMd && mdPublish > jsonPublish);

  const create = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempIdentityErrorCode)", fsync);
  const destinationIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationIdentityErrorCode)", tempIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);
  assert.ok(
    create >= 0 &&
      fsync > create &&
      tempIdentity > fsync &&
      destinationIdentity > tempIdentity &&
      rename > destinationIdentity,
  );

  assert.match(source, /CANONICAL_CALIBRATION_PREEXISTING_JSON_IDENTITY_INVALID/);
  assert.match(source, /CANONICAL_CALIBRATION_PREEXISTING_MD_IDENTITY_INVALID/);
  assert.match(source, /CANONICAL_CALIBRATION_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /CANONICAL_CALIBRATION_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(source, /CANONICAL_CALIBRATION_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /CANONICAL_CALIBRATION_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
});

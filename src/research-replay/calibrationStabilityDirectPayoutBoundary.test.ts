import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("calibration stability direct analyzer fails closed on non-canonical or ambiguous official settlements", () => {
  const source = readFileSync("scripts/analyze-calibration-stability.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertOfficialSettlementIntegrity\(\)/);
  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.bet_type='trifecta'/);
  assert.match(source, /rp\.combination=decision_history\.selection/);
  assert.match(source, /WHERE total_rows != 1 OR valid_rows != 1/);
  assert.match(source, /CALIBRATION_STABILITY_OFFICIAL_SETTLEMENT_INVALID/);
  assert.match(source, /assertPayoutCompleteness\(train, "train"\)/);
  assert.match(source, /assertPayoutCompleteness\(forward, "forward"\)/);
  assert.match(source, /CALIBRATION_STABILITY_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /hits\.map\(requiredPayout\)/);
  assert.match(source, /requiredPayout\(b\.r\) > requiredPayout\(a\.r\)/);
  assert.match(source, /payoutBasis:"race_payouts\.payout_yen \/ 100円 \(official trifecta settlement\)"/);
  assert.doesNotMatch(source, /SELECT id,date,venue,selection,estimated_hit_rate,current_odds,result,payout_yen\s+FROM decision_history/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

test("calibration stability validates existing reports and publishes atomically", () => {
  const source = readFileSync("scripts/analyze-calibration-stability.ts", "utf8");

  const preflightJson = source.indexOf("verifyExistingOutput(OUT_JSON");
  const preflightMd = source.indexOf("verifyExistingOutput(OUT_MD");
  const jsonPublish = source.indexOf("atomicPublish(OUT_JSON");
  const mdPublish = source.indexOf("atomicPublish(OUT_MD");
  assert.ok(preflightJson >= 0 && preflightMd > preflightJson && jsonPublish > preflightMd && mdPublish > jsonPublish);

  const create = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, identityErrorCode)", fsync);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", identity);
  assert.ok(create >= 0 && fsync > create && identity > fsync && rename > identity);

  assert.match(source, /CALIBRATION_STABILITY_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /CALIBRATION_STABILITY_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
});

test("calibration stability payout audit uses the same official settlement authority", () => {
  const source = readFileSync("scripts/audit-calibration-stability-payout-completeness.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /WHERE total_rows != 1 OR valid_rows != 1/);
  assert.match(source, /CALIBRATION_STABILITY_OFFICIAL_SETTLEMENT_INVALID/);
  assert.match(source, /payoutBasis: "official-race_payouts"/);
});

test("calibration stability payout audit pins integrity and coverage checks to one read snapshot", () => {
  const source = readFileSync("scripts/audit-calibration-stability-payout-completeness.ts", "utf8");
  const queryOnly = source.indexOf("PRAGMA query_only = ON");
  const begin = source.indexOf('db.exec("BEGIN;")');
  const blankResult = source.indexOf("const blankResult = db.prepare");
  const invalidReturn = source.indexOf("const invalidReturn = db.prepare");
  const settlementIntegrity = source.indexOf("const duplicateOrInvalid = db.prepare");
  const coverage = source.indexOf("const rows = db.prepare");

  assert.ok(queryOnly >= 0);
  assert.ok(begin > queryOnly);
  assert.ok(blankResult > begin);
  assert.ok(invalidReturn > blankResult);
  assert.ok(settlementIntegrity > invalidReturn);
  assert.ok(coverage > settlementIntegrity);
});

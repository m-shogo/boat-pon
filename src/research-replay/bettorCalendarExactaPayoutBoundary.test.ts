import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("bettor-calendar ROI fails closed on incomplete official exacta payouts", () => {
  const source = readFileSync("scripts/analyze-bettor-calendar.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath,\{readOnly:true\}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertSettlementCompleteness\(\)/);
  assert.match(source, /COUNT\(\*\) AS payout_rows/);
  assert.match(source, /rp\.returned=0 AND rp\.payout_yen IS NOT NULL AND rp\.payout_yen>0/);
  assert.match(source, /winner_h\.race_id=rp\.race_id/);
  assert.match(source, /historicalExactaCanonicalSourcePredicate\("winner_h"\)/);
  assert.match(source, /winner_h\.combination=rp\.combination/);
  assert.match(source, /s\.payout_rows=1 AND s\.valid_rows=1/);
  assert.match(source, /ambiguous!==0/);
  assert.match(source, /BETTOR_CALENDAR_EXACTA_SETTLEMENT_INTEGRITY_INVALID/);
  assert.match(source, /assertPayoutCompleteness\(rows\)/);
  assert.match(source, /BETTOR_CALENDAR_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /map\(requiredPayout\)/);
  assert.doesNotMatch(source, /payout_yen\?\?0/);
});

test("bettor-calendar publishes reports via exclusive fsynced verified temp files and atomic rename", () => {
  const source = readFileSync("scripts/analyze-bettor-calendar.ts", "utf8");

  assert.match(source, /openSync\(tempPath,"wx",0o600\)/u);
  assert.match(source, /writeFileSync\(fd,contents,"utf8"\);fsyncSync\(fd\);/u);
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(tempPath,errorCode\);renameSync\(verifiedTempPath,path\);/u);
  assert.match(source, /BETTOR_CALENDAR_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /BETTOR_CALENDAR_MARKDOWN_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /atomicPublish\(JSON_REPORT_PATH,/u);
  assert.match(source, /atomicPublish\(MARKDOWN_REPORT_PATH,/u);
  assert.doesNotMatch(source, /writeFileSync\("reports\/bettor-calendar-screen\.(?:json|md)"/u);
});

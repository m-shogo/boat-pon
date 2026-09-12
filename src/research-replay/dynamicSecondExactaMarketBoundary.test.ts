import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-dynamic-second-selector.ts", "utf8");

test("dynamic second selector builds candidate and price maps from canonical complete exacta markets", () => {
  assert.ok((source.match(/historicalExactaCanonicalSourcePredicate\("h"\)/g) ?? []).length >= 3);
  assert.ok((source.match(/historicalExactaCompleteMarketPredicate\("h\.race_id"\)/g) ?? []).length >= 3);
  assert.doesNotMatch(source, /HAVING COUNT\(\*\)=30/);
  assert.doesNotMatch(source, /SELECT race_id,combination,odds FROM historical_alternative_odds WHERE bet_type='exacta'/);
});

test("dynamic second selector verifies the canonical read-only database before analysis", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "DYNAMIC_SECOND_PRIMARY_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
});

test("dynamic second selector fails closed on missing or ambiguous exacta settlement before ROI", () => {
  assert.match(source, /DYNAMIC_SECOND_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /s\.payout_rows=1 AND s\.valid_rows=1/);
  assert.match(source, /COALESCE\(s\.payout_rows,0\)>1/);
  assert.match(source, /rp\.returned=0/);
  assert.match(source, /rp\.payout_yen IS NOT NULL AND rp\.payout_yen>0/);
  assert.match(source, /rp\.combination IS NOT NULL AND trim\(rp\.combination\)!=''/);

  const preflightIndex = source.indexOf("assertSettlementCompleteness();");
  const racesIndex = source.indexOf("const races = db.prepare");
  assert.ok(preflightIndex >= 0);
  assert.ok(racesIndex > preflightIndex, "settlement integrity must pass before candidate rows are materialized");
});

test("dynamic second selector consumes only the one validated non-refund exacta settlement", () => {
  assert.match(source, /JOIN race_payouts p ON p\.race_id=m\.race_id/);
  assert.match(source, /p\.bet_type='exacta'/);
  assert.match(source, /p\.returned=0/);
  assert.match(source, /p\.payout_yen IS NOT NULL AND p\.payout_yen>0/);
  assert.doesNotMatch(source, /LEFT JOIN race_payouts p ON p\.race_id=h\.race_id AND p\.bet_type='exacta'/);
});

test("dynamic second selector publishes reports via exclusive fsynced verified temp files and atomic rename", () => {
  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(source, /writeFileSync\(fd, contents, "utf8"\);\s*fsyncSync\(fd\);/u);
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(tempPath, errorCode\);\s*renameSync\(verifiedTempPath, path\);/u);
  assert.match(source, /DYNAMIC_SECOND_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /DYNAMIC_SECOND_MARKDOWN_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /atomicPublish\(\s*JSON_REPORT_PATH,/u);
  assert.match(source, /atomicPublish\(\s*MARKDOWN_REPORT_PATH,/u);
  assert.doesNotMatch(source, /writeFileSync\("reports\/dynamic-second-selector\.(?:json|md)"/u);
});

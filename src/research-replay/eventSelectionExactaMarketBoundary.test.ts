import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("event selection matrix uses canonical historical exacta source and completeness authority", () => {
  const source = readFileSync("scripts/analyze-event-selection-matrix.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /historicalExactaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.doesNotMatch(source, /COUNT\(\*\) FROM historical_alternative_odds all_odds WHERE all_odds\.race_id=h\.race_id AND all_odds\.bet_type='exacta'\)\s*=\s*30/);
});

test("event selection matrix fails closed on database identity and settlement completeness", () => {
  const source = readFileSync("scripts/analyze-event-selection-matrix.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertSettlementCompleteness\(\);/);
  assert.match(source, /COUNT\(\*\) AS payout_rows/);
  assert.match(source, /rp\.returned = 0 AND rp\.payout_yen IS NOT NULL AND rp\.payout_yen > 0/);
  assert.match(source, /winner_h\.race_id=rp\.race_id/);
  assert.match(source, /historicalExactaCanonicalSourcePredicate\("winner_h"\)/);
  assert.match(source, /winner_h\.combination=rp\.combination/);
  assert.match(source, /s\.payout_rows = 1 AND s\.valid_rows = 1/);
  assert.match(source, /ambiguous !== 0/);
  assert.match(source, /p\.bet_type='exacta' AND p\.returned=0 AND p\.payout_yen>0/);
  assert.match(source, /EVENT_SELECTION_MATRIX_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /requiredPayout\(row\)/);
  assert.match(source, /EVENT_SELECTION_MATRIX_HIT_PAYOUT_MISSING/);
  assert.doesNotMatch(source, /row=>row\.payout_yen\?\?0/);
});

test("event selection matrix verifies event-title inputs before parsing", () => {
  const source = readFileSync("scripts/analyze-event-selection-matrix.ts", "utf8");
  const identity = source.indexOf('assertCanonicalSingleLinkRegularFile(path, "EVENT_SELECTION_MATRIX_EVENT_TITLE_IDENTITY_INVALID")');
  const read = source.indexOf('readFileSync(verifiedPath, "utf8")', identity);
  assert.ok(identity >= 0 && read > identity);
  assert.doesNotMatch(source, /load\(readFileSync\(path/);
});

test("event selection matrix validates existing reports and publishes atomically", () => {
  const source = readFileSync("scripts/analyze-event-selection-matrix.ts", "utf8");
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

  assert.match(source, /EVENT_SELECTION_MATRIX_PREEXISTING_JSON_IDENTITY_INVALID/);
  assert.match(source, /EVENT_SELECTION_MATRIX_PREEXISTING_MD_IDENTITY_INVALID/);
  assert.match(source, /EVENT_SELECTION_MATRIX_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /EVENT_SELECTION_MATRIX_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
});

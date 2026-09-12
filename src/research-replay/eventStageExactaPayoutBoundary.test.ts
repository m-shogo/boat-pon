import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source=readFileSync("scripts/analyze-event-stage-market.ts","utf8");

test("event-stage market screen keeps canonical complete exacta population", () => {
  assert.match(source,/historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source,/historicalExactaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.match(source,/HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.match(source,/status_code='F'/);
});

test("event-stage market screen fails closed on DB identity and payout settlement", () => {
  assert.match(source,/assertCanonicalSingleLinkRegularFile\(DB_PATH,"RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source,/new DatabaseSync\(verifiedDbPath,\{readOnly:true\}\)/);
  assert.match(source,/PRAGMA query_only=ON/);
  assert.match(source,/assertSettlementCompleteness\(\);/);
  assert.match(source,/COUNT\(\*\) AS payout_rows/);
  assert.match(source,/rp\.returned=0 AND rp\.payout_yen IS NOT NULL AND rp\.payout_yen>0/);
  assert.match(source,/winner_h\.race_id=rp\.race_id/);
  assert.match(source,/historicalExactaCanonicalSourcePredicate\("winner_h"\)/);
  assert.match(source,/winner_h\.combination=rp\.combination/);
  assert.match(source,/s\.payout_rows=1 AND s\.valid_rows=1/);
  assert.match(source,/ambiguous!==0/);
  assert.match(source,/p\.bet_type='exacta' AND p\.returned=0 AND p\.payout_yen>0/);
  assert.match(source,/EVENT_STAGE_MARKET_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source,/requiredPayout/);
  assert.match(source,/EVENT_STAGE_MARKET_HIT_PAYOUT_MISSING/);
  assert.doesNotMatch(source,/r=>r\.payout_yen\?\?0/);
});

test("event-stage market screen verifies stored event HTML identity before parsing", () => {
  const identity=source.indexOf('assertCanonicalSingleLinkRegularFile(path,"EVENT_STAGE_MARKET_EVENT_HTML_IDENTITY_INVALID")');
  const read=source.indexOf('readFileSync(verifiedPath,"utf8")',identity);
  assert.ok(identity>=0&&read>identity);
  assert.doesNotMatch(source,/load\(readFileSync\(path/);
});

test("event-stage market screen validates existing reports before atomic replacement", () => {
  const jsonPreflight=source.indexOf("verifyExistingOutput(OUT_JSON");
  const mdPreflight=source.indexOf("verifyExistingOutput(OUT_MD");
  const jsonPublish=source.indexOf("atomicPublish(OUT_JSON");
  const mdPublish=source.indexOf("atomicPublish(OUT_MD");
  assert.ok(jsonPreflight>=0&&mdPreflight>jsonPreflight&&jsonPublish>mdPreflight&&mdPublish>jsonPublish);
  assert.match(source,/EVENT_STAGE_MARKET_PREEXISTING_JSON_IDENTITY_INVALID/);
  assert.match(source,/EVENT_STAGE_MARKET_PREEXISTING_MD_IDENTITY_INVALID/);
});

test("event-stage market screen publication is exclusive fsynced identity-checked and atomic", () => {
  const create=source.indexOf('openSync(tempPath,"wx",0o600)');
  const fsync=source.indexOf("fsyncSync(fd)",create);
  const identity=source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath,identityErrorCode)",fsync);
  const rename=source.indexOf("renameSync(verifiedTempPath,path)",identity);
  assert.ok(create>=0&&fsync>create&&identity>fsync&&rename>identity);
  assert.match(source,/EVENT_STAGE_MARKET_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source,/EVENT_STAGE_MARKET_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
});

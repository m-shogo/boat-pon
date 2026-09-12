import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-rookie-event-edge.ts", "utf8");

test("rookie-event screen uses canonical historical exacta source and completeness authority", () => {
  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.doesNotMatch(source, /HAVING COUNT\(\*\)=30/);
});

test("rookie-event ROI fails closed on incomplete or ambiguous official payouts", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath,\{readOnly:true\}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /COUNT\(\*\) AS payout_rows/);
  assert.match(source, /returned=0 AND payout_yen IS NOT NULL AND payout_yen>0/);
  assert.match(source, /row\.payout_rows===1&&row\.valid_rows===1/);
  assert.match(source, /row\.payout_rows>1/);
  assert.match(source, /assertPayoutCompleteness\(evaluations\)/);
  assert.match(source, /ROOKIE_EVENT_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /map\(requiredPayout\)/);
  assert.doesNotMatch(source, /payout_yen\?\?0/);
});

test("rookie-event screen verifies stored event HTML identity before parsing", () => {
  const identity=source.indexOf('assertCanonicalSingleLinkRegularFile(path,"ROOKIE_EVENT_EVENT_HTML_IDENTITY_INVALID")');
  const read=source.indexOf('readFileSync(verifiedPath,"utf8")',identity);
  assert.ok(identity>=0&&read>identity);
  assert.doesNotMatch(source,/load\(readFileSync\(path/);
});

test("rookie-event screen validates existing reports before atomic replacement", () => {
  const jsonPreflight=source.indexOf("verifyExistingOutput(OUT_JSON");
  const mdPreflight=source.indexOf("verifyExistingOutput(OUT_MD");
  const jsonPublish=source.indexOf("atomicPublish(OUT_JSON");
  const mdPublish=source.indexOf("atomicPublish(OUT_MD");
  assert.ok(jsonPreflight>=0&&mdPreflight>jsonPreflight&&jsonPublish>mdPreflight&&mdPublish>jsonPublish);
  assert.match(source,/ROOKIE_EVENT_PREEXISTING_JSON_IDENTITY_INVALID/);
  assert.match(source,/ROOKIE_EVENT_PREEXISTING_MD_IDENTITY_INVALID/);
});

test("rookie-event screen publication is exclusive fsynced identity-checked and atomic", () => {
  const create=source.indexOf('openSync(tempPath,"wx",0o600)');
  const fsync=source.indexOf("fsyncSync(fd)",create);
  const identity=source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath,identityErrorCode)",fsync);
  const rename=source.indexOf("renameSync(verifiedTempPath,path)",identity);
  assert.ok(create>=0&&fsync>create&&identity>fsync&&rename>identity);
  assert.match(source,/ROOKIE_EVENT_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source,/ROOKIE_EVENT_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
});

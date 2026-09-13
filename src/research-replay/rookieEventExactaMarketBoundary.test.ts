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

test("rookie-event screen preflights both report destinations before first replacement", () => {
  const publicationStart=source.indexOf('mkdirSync("reports",{recursive:true});');
  assert.notEqual(publicationStart,-1);
  const publication=source.slice(publicationStart);
  const reportsIdentity=publication.indexOf("ROOKIE_EVENT_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const jsonPreflight=publication.indexOf('verifyExistingOutput(OUT_JSON,"ROOKIE_EVENT_PREEXISTING_JSON_IDENTITY_INVALID")');
  const mdPreflight=publication.indexOf('verifyExistingOutput(OUT_MD,"ROOKIE_EVENT_PREEXISTING_MD_IDENTITY_INVALID")');
  const jsonPublish=publication.indexOf("atomicPublish(OUT_JSON");
  const mdPublish=publication.indexOf("atomicPublish(OUT_MD");
  assert.ok(reportsIdentity>=0&&jsonPreflight>reportsIdentity&&mdPreflight>jsonPreflight&&jsonPublish>mdPreflight&&mdPublish>jsonPublish);
});

test("rookie-event screen publication verifies destination and parent handoff before atomic rename", () => {
  const helperStart=source.indexOf("function atomicPublish(");
  const byPeriodStart=source.indexOf("function byPeriod",helperStart);
  assert.notEqual(helperStart,-1);
  assert.notEqual(byPeriodStart,-1);
  const helper=source.slice(helperStart,byPeriodStart);
  const parentIdentity=helper.indexOf("ROOKIE_EVENT_PUBLISH_PARENT_IDENTITY_INVALID");
  const create=helper.indexOf('openSync(tempPath,"wx",0o600)');
  const fsync=helper.indexOf("fsyncSync(fd)",create);
  const tempIdentity=helper.indexOf("assertCanonicalSingleLinkRegularFile(tempPath,tempIdentityErrorCode)",fsync);
  const destinationIdentity=helper.indexOf("verifyExistingOutput(path,destinationIdentityErrorCode)",tempIdentity);
  const parentHandoff=helper.indexOf("ROOKIE_EVENT_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID",destinationIdentity);
  const rename=helper.indexOf("renameSync(verifiedTempPath,path)",parentHandoff);
  assert.ok(parentIdentity>=0&&create>parentIdentity&&fsync>create&&tempIdentity>fsync&&destinationIdentity>tempIdentity&&parentHandoff>destinationIdentity&&rename>parentHandoff);
  assert.match(source,/ROOKIE_EVENT_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source,/ROOKIE_EVENT_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source,/ROOKIE_EVENT_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(source,/ROOKIE_EVENT_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
});

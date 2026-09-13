import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-track-mood-market.ts", "utf8");

test("track mood market uses canonical historical exacta source and completeness authority", () => {
  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /historicalExactaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.doesNotMatch(source, /COUNT\(\*\) FROM historical_alternative_odds a WHERE a\.race_id=h\.race_id AND a\.bet_type='exacta'\)\s*=\s*30/);
});

test("track mood ROI fails closed on incomplete or ambiguous official payouts", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath,\{readOnly:true\}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /COUNT\(\*\) AS payout_rows/);
  assert.match(source, /returned=0 AND payout_yen IS NOT NULL AND payout_yen>0/);
  assert.match(source, /row\.payout_rows===1&&row\.valid_rows===1/);
  assert.match(source, /row\.payout_rows>1/);
  assert.match(source, /assertPayoutCompleteness\(oddsByRace\)/);
  assert.match(source, /TRACK_MOOD_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /map\(requiredPayout\)/);
  assert.doesNotMatch(source, /payout_yen\?\?0/);
});

test("track mood reports preflight both destinations before first replacement", () => {
  const publicationStart=source.indexOf('mkdirSync("reports",{recursive:true});');
  assert.notEqual(publicationStart,-1);
  const publication=source.slice(publicationStart);
  const reportsIdentity=publication.indexOf("TRACK_MOOD_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const jsonPreflight=publication.indexOf('verifyExistingOutput(JSON_REPORT_PATH,"TRACK_MOOD_PREEXISTING_JSON_IDENTITY_INVALID")');
  const markdownPreflight=publication.indexOf('verifyExistingOutput(MARKDOWN_REPORT_PATH,"TRACK_MOOD_PREEXISTING_MARKDOWN_IDENTITY_INVALID")');
  const jsonPublish=publication.indexOf("atomicPublish(JSON_REPORT_PATH");
  const markdownPublish=publication.indexOf("atomicPublish(MARKDOWN_REPORT_PATH");
  assert.ok(reportsIdentity>=0&&jsonPreflight>reportsIdentity&&markdownPreflight>jsonPreflight&&jsonPublish>markdownPreflight&&markdownPublish>jsonPublish);
});

test("track mood publication verifies destination and parent handoff before atomic rename", () => {
  const helperStart=source.indexOf("function atomicPublish(");
  const payoutStart=source.indexOf("function assertPayoutCompleteness",helperStart);
  assert.notEqual(helperStart,-1);
  assert.notEqual(payoutStart,-1);
  const helper=source.slice(helperStart,payoutStart);
  const parentIdentity=helper.indexOf("TRACK_MOOD_PUBLISH_PARENT_IDENTITY_INVALID");
  const create=helper.indexOf('openSync(tempPath,"wx",0o600)');
  const fsync=helper.indexOf("fsyncSync(fd)",create);
  const tempIdentity=helper.indexOf("assertCanonicalSingleLinkRegularFile(tempPath,tempIdentityErrorCode)",fsync);
  const destinationIdentity=helper.indexOf("verifyExistingOutput(path,destinationIdentityErrorCode)",tempIdentity);
  const parentHandoff=helper.indexOf("TRACK_MOOD_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID",destinationIdentity);
  const rename=helper.indexOf("renameSync(verifiedTempPath,path)",parentHandoff);
  assert.ok(parentIdentity>=0&&create>parentIdentity&&fsync>create&&tempIdentity>fsync&&destinationIdentity>tempIdentity&&parentHandoff>destinationIdentity&&rename>parentHandoff);
  assert.match(source,/TRACK_MOOD_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source,/TRACK_MOOD_MARKDOWN_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source,/TRACK_MOOD_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(source,/TRACK_MOOD_MARKDOWN_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.doesNotMatch(source, /writeFileSync\("reports\/track-mood-market-screen\.(?:json|md)"/);
});
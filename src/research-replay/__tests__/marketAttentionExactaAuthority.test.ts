import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("market attention uses canonical exacta authority for odds and overround", () => {
  const source = readFileSync("scripts/analyze-market-attention.ts", "utf8");

  assert.match(source, /historicalExactaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /historicalExactaCanonicalSourcePredicate\(\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
});

test("market attention ROI fails closed on incomplete official payouts", () => {
  const source = readFileSync("scripts/analyze-market-attention.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(dbPath,\{readOnly:true\}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertPayoutCompleteness\(odds\)/);
  assert.match(source, /MARKET_ATTENTION_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /requiredPayout\(row\)/);
  assert.doesNotMatch(source, /payout_yen\?\?0/);
});

test("market attention preflights scalar exacta settlement integrity before evaluating schedule effects", () => {
  const source = readFileSync("scripts/analyze-market-attention.ts", "utf8");
  const preflight = source.indexOf("assertSettlementCoverage(coverage)");
  const analysis = source.indexOf("const odds=db.prepare");

  assert.ok(preflight >= 0 && analysis > preflight, "settlement integrity must pass before attention aggregation");
  assert.match(source, /CASE WHEN COUNT\(\*\)=1/);
  assert.match(source, /MARKET_ATTENTION_EXACTA_SETTLEMENT_INTEGRITY_INVALID/);
  assert.match(source, /JOIN race_payouts p ON p\.race_id=h\.race_id AND p\.bet_type='exacta'/);
  assert.match(source, /SELECT COUNT\(\*\) FROM race_payouts rp WHERE rp\.race_id=h\.race_id AND rp\.bet_type='exacta'\)=1/);
  assert.match(source, /p\.returned=0/);
  assert.match(source, /p\.combination IS NOT NULL AND trim\(p\.combination\)!=''/);
  assert.match(source, /p\.payout_yen IS NOT NULL AND p\.payout_yen>0/);
  assert.match(source, /historicalExactaCanonicalSourcePredicate\("winner_h"\)/);
  assert.match(source, /winner_h\.combination=p\.combination/);
  assert.doesNotMatch(source, /LEFT JOIN race_payouts p/);
});

test("market attention preflights both report destinations before first replacement", () => {
  const source = readFileSync("scripts/analyze-market-attention.ts", "utf8");
  const publicationStart = source.indexOf('mkdirSync("reports",{recursive:true});');
  assert.notEqual(publicationStart, -1);
  const publication = source.slice(publicationStart);
  const reportsIdentity = publication.indexOf("MARKET_ATTENTION_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const jsonPreflight = publication.indexOf('verifyExistingOutput(JSON_REPORT_PATH,"MARKET_ATTENTION_PREEXISTING_JSON_IDENTITY_INVALID")');
  const markdownPreflight = publication.indexOf('verifyExistingOutput(MARKDOWN_REPORT_PATH,"MARKET_ATTENTION_PREEXISTING_MARKDOWN_IDENTITY_INVALID")');
  const jsonPublish = publication.indexOf("atomicPublish(JSON_REPORT_PATH");
  const markdownPublish = publication.indexOf("atomicPublish(MARKDOWN_REPORT_PATH");

  assert.ok(
    reportsIdentity >= 0 &&
      jsonPreflight > reportsIdentity &&
      markdownPreflight > jsonPreflight &&
      jsonPublish > markdownPreflight &&
      markdownPublish > jsonPublish,
  );
});

test("market attention publication verifies destination and parent handoff before atomic rename", () => {
  const source = readFileSync("scripts/analyze-market-attention.ts", "utf8");
  const helperStart = source.indexOf("function atomicPublish(");
  const outerTry = source.indexOf("try{", helperStart + "function atomicPublish(".length);
  assert.notEqual(helperStart, -1);
  const helperEnd = source.indexOf("\ntry{", helperStart);
  assert.notEqual(helperEnd, -1);
  const helper = source.slice(helperStart, helperEnd);
  const parentIdentity = helper.indexOf("MARKET_ATTENTION_PUBLISH_PARENT_IDENTITY_INVALID");
  const create = helper.indexOf('openSync(tempPath,"wx",0o600)');
  const fsync = helper.indexOf("fsyncSync(fd)", create);
  const tempIdentity = helper.indexOf("assertCanonicalSingleLinkRegularFile(tempPath,tempIdentityErrorCode)", fsync);
  const destinationIdentity = helper.indexOf("verifyExistingOutput(path,destinationIdentityErrorCode)", tempIdentity);
  const parentHandoff = helper.indexOf("MARKET_ATTENTION_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = helper.indexOf("renameSync(verifiedTempPath,path)", parentHandoff);

  assert.ok(outerTry >= 0);
  assert.ok(
    parentIdentity >= 0 &&
      create > parentIdentity &&
      fsync > create &&
      tempIdentity > fsync &&
      destinationIdentity > tempIdentity &&
      parentHandoff > destinationIdentity &&
      rename > parentHandoff,
  );
  assert.match(source, /MARKET_ATTENTION_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /MARKET_ATTENTION_MARKDOWN_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.doesNotMatch(source, /writeFileSync\("reports\/market-attention-screen\.(?:json|md)"/u);
});

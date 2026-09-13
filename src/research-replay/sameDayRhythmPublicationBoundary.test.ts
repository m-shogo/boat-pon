import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-same-day-rhythm-market.ts", "utf8");

test("same-day rhythm reports preflight both destinations before first replacement", () => {
  const publicationStart = source.indexOf('mkdirSync("reports",{recursive:true});');
  assert.notEqual(publicationStart, -1);
  const publication = source.slice(publicationStart);
  const reportsIdentity = publication.indexOf("SAME_DAY_RHYTHM_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const jsonPreflight = publication.indexOf('verifyExistingOutput(JSON_REPORT_PATH,"SAME_DAY_RHYTHM_PREEXISTING_JSON_IDENTITY_INVALID")');
  const markdownPreflight = publication.indexOf('verifyExistingOutput(MARKDOWN_REPORT_PATH,"SAME_DAY_RHYTHM_PREEXISTING_MARKDOWN_IDENTITY_INVALID")');
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

test("same-day rhythm publication verifies destination and parent handoff before atomic rename", () => {
  const helperStart = source.indexOf("function atomicPublish(");
  const settlementStart = source.indexOf("function assertSettlementCoverage", helperStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(settlementStart, -1);
  const helper = source.slice(helperStart, settlementStart);
  const parentIdentity = helper.indexOf("SAME_DAY_RHYTHM_PUBLISH_PARENT_IDENTITY_INVALID");
  const create = helper.indexOf('openSync(tempPath,"wx",0o600)');
  const fsync = helper.indexOf("fsyncSync(fd)", create);
  const tempIdentity = helper.indexOf("assertCanonicalSingleLinkRegularFile(tempPath,tempIdentityErrorCode)", fsync);
  const destinationIdentity = helper.indexOf("verifyExistingOutput(path,destinationIdentityErrorCode)", tempIdentity);
  const parentHandoff = helper.indexOf("SAME_DAY_RHYTHM_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = helper.indexOf("renameSync(verifiedTempPath,path)", parentHandoff);

  assert.ok(
    parentIdentity >= 0 &&
      create > parentIdentity &&
      fsync > create &&
      tempIdentity > fsync &&
      destinationIdentity > tempIdentity &&
      parentHandoff > destinationIdentity &&
      rename > parentHandoff,
  );
});

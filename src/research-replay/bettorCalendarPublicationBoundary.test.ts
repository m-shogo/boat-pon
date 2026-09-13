import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-bettor-calendar.ts", "utf8");

test("bettor calendar preflights both canonical destinations before the first publication", () => {
  const reportsIdentity = source.indexOf('assertCanonicalDirectory("reports","BETTOR_CALENDAR_REPORTS_DIRECTORY_IDENTITY_INVALID")');
  const jsonPreflight = source.indexOf('verifyExistingDestination(JSON_REPORT_PATH,"BETTOR_CALENDAR_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID")', reportsIdentity);
  const mdPreflight = source.indexOf('verifyExistingDestination(MARKDOWN_REPORT_PATH,"BETTOR_CALENDAR_MARKDOWN_PREPUBLISH_DESTINATION_IDENTITY_INVALID")', jsonPreflight);
  const firstPublish = source.indexOf("atomicPublish(JSON_REPORT_PATH", mdPreflight);

  assert.ok(reportsIdentity >= 0);
  assert.ok(jsonPreflight > reportsIdentity);
  assert.ok(mdPreflight > jsonPreflight);
  assert.ok(firstPublish > mdPreflight);
});

test("bettor calendar publishes reports through an atomic identity-checked parent handoff", () => {
  const helperStart = source.indexOf("function atomicPublish(");
  const publishStart = source.indexOf("try{assertSettlementCompleteness()", helperStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(publishStart, -1);
  const helper = source.slice(helperStart, publishStart);

  const parentIdentity = helper.indexOf("BETTOR_CALENDAR_PUBLISH_PARENT_IDENTITY_INVALID");
  const open = helper.indexOf('openSync(tempPath,"wx",0o600)');
  const write = helper.indexOf('writeFileSync(fd,contents,"utf8")');
  const fsync = helper.indexOf("fsyncSync(fd)");
  const tempIdentity = helper.indexOf("assertCanonicalSingleLinkRegularFile(tempPath,tempErrorCode)");
  const destinationIdentity = helper.indexOf("verifyExistingDestination(path,destinationErrorCode)");
  const parentHandoff = helper.indexOf("BETTOR_CALENDAR_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID");
  const rename = helper.indexOf("renameSync(verifiedTempPath,path)");

  assert.ok(parentIdentity >= 0);
  assert.ok(parentIdentity < open);
  assert.ok(open < write);
  assert.ok(write < fsync);
  assert.ok(fsync < tempIdentity);
  assert.ok(tempIdentity < destinationIdentity);
  assert.ok(destinationIdentity < parentHandoff);
  assert.ok(parentHandoff < rename);
});

test("bettor calendar report outputs use the atomic publisher instead of direct destination writes", () => {
  assert.match(source, /atomicPublish\(JSON_REPORT_PATH,/u);
  assert.match(source, /atomicPublish\(MARKDOWN_REPORT_PATH,/u);
  assert.doesNotMatch(source, /writeFileSync\(JSON_REPORT_PATH/u);
  assert.doesNotMatch(source, /writeFileSync\(MARKDOWN_REPORT_PATH/u);
});

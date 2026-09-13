import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-motor-filter-consistency.ts", "utf8");

test("motor filter consistency keeps the canonical read-only DB and settlement boundary", () => {
  assert.match(source, /MOTOR_FILTER_PRIMARY_DB_IDENTITY_INVALID/u);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only = ON/u);
  assert.match(source, /assertSettledResultIntegrity\(\)/u);
  assert.match(source, /assertReturnStateIntegrity\(\)/u);
  assert.match(source, /assertWinningSettlementIntegrity\(\)/u);
});

test("motor filter consistency preflights both canonical destinations before the first publication", () => {
  const reportsIdentity = source.indexOf('assertCanonicalDirectory("reports", "MOTOR_FILTER_REPORTS_DIRECTORY_IDENTITY_INVALID")');
  const jsonPreflight = source.indexOf('verifyExistingDestination(OUT_JSON, "MOTOR_FILTER_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID")', reportsIdentity);
  const mdPreflight = source.indexOf('verifyExistingDestination(OUT_MD, "MOTOR_FILTER_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID")', jsonPreflight);
  const firstPublish = source.indexOf("atomicPublish(", mdPreflight);

  assert.ok(reportsIdentity >= 0);
  assert.ok(jsonPreflight > reportsIdentity);
  assert.ok(mdPreflight > jsonPreflight);
  assert.ok(firstPublish > mdPreflight);
});

test("motor filter consistency publishes both outputs through verified parent and destination handoff", () => {
  const helperStart = source.indexOf("function atomicPublish(");
  const parentIdentity = source.indexOf("MOTOR_FILTER_PUBLISH_PARENT_IDENTITY_INVALID", helperStart);
  const exclusiveOpen = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", exclusiveOpen);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationIdentity = source.indexOf("verifyExistingDestination(path, destinationErrorCode)", tempIdentity);
  const parentHandoff = source.indexOf("MOTOR_FILTER_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);

  assert.ok(
    helperStart >= 0 &&
      parentIdentity > helperStart &&
      exclusiveOpen > parentIdentity &&
      fsync > exclusiveOpen &&
      tempIdentity > fsync &&
      destinationIdentity > tempIdentity &&
      parentHandoff > destinationIdentity &&
      rename > parentHandoff,
  );
  assert.match(source, /MOTOR_FILTER_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /MOTOR_FILTER_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /MOTOR_FILTER_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /MOTOR_FILTER_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD/u);
});

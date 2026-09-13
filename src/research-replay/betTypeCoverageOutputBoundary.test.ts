import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/audit-bet-type-coverage.ts", "utf8");

test("bet-type coverage keeps its canonical read-only DB boundary", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/u);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only = ON/u);
  assert.match(source, /REPORT_DB_LABEL = "canonical research database"/u);
});

test("bet-type coverage publishes both outputs through exclusive verified temp files", () => {
  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(source, /fsyncSync\(fd\)/u);
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(tempPath, tempErrorCode\)/u);
  assert.match(source, /verifyExistingOutput\(path, destinationErrorCode\)/u);
  assert.match(source, /BET_TYPE_COVERAGE_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID/u);
  assert.match(source, /renameSync\(verifiedTempPath, path\)/u);
  assert.match(source, /BET_TYPE_COVERAGE_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /BET_TYPE_COVERAGE_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /BET_TYPE_COVERAGE_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /BET_TYPE_COVERAGE_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON/u);
});

test("bet-type coverage preflights the complete destination set before publishing either output", () => {
  const reportsIdentity = source.indexOf("BET_TYPE_COVERAGE_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const mdPreflight = source.indexOf("BET_TYPE_COVERAGE_PREEXISTING_MD_IDENTITY_INVALID", reportsIdentity);
  const jsonPreflight = source.indexOf("BET_TYPE_COVERAGE_PREEXISTING_JSON_IDENTITY_INVALID", mdPreflight);
  const firstPublish = source.indexOf("atomicPublish(\n  OUT_MD", jsonPreflight);
  assert.ok(reportsIdentity >= 0);
  assert.ok(mdPreflight > reportsIdentity);
  assert.ok(jsonPreflight > mdPreflight);
  assert.ok(firstPublish > jsonPreflight);
});

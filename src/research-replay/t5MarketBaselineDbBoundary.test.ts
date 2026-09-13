import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/audit-t5-market-baseline.ts", "utf8");

test("T-5 market baseline preserves a canonical read-only database boundary", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "T5_MARKET_BASELINE_DB_IDENTITY_INVALID"\)/u);
  assert.match(source, /new DatabaseSync\(verifiedDbPath,\{readOnly:true\}\)/u);
  assert.match(source, /PRAGMA query_only=ON/u);
});

test("T-5 market baseline does not expose the configured database path on missing DB", () => {
  assert.match(source, /T5_MARKET_BASELINE_DB_MISSING/u);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/u);
});

test("T-5 market baseline preflights both canonical destinations before the first publication", () => {
  const reportsIdentity = source.indexOf('assertCanonicalDirectory("reports","T5_MARKET_BASELINE_REPORTS_DIRECTORY_IDENTITY_INVALID")');
  const jsonPreflight = source.indexOf('verifyExistingDestination(OUT_JSON,"T5_MARKET_BASELINE_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID")');
  const mdPreflight = source.indexOf('verifyExistingDestination(OUT_MD,"T5_MARKET_BASELINE_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID")');
  const firstPublish = source.indexOf("atomicPublish(OUT_JSON");
  assert.ok(reportsIdentity >= 0);
  assert.ok(jsonPreflight > reportsIdentity);
  assert.ok(mdPreflight > jsonPreflight);
  assert.ok(firstPublish > mdPreflight);
});

test("T-5 market baseline publishes Markdown and JSON through verified parent handoff", () => {
  assert.match(source, /openSync\(tempPath,"wx",0o600\)/u);
  assert.match(source, /fsyncSync\(fd\)/u);
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(tempPath,tempErrorCode\)/u);
  assert.match(source, /verifyExistingDestination\(path,destinationErrorCode\)/u);
  assert.match(source, /T5_MARKET_BASELINE_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID/u);
  assert.match(source, /renameSync\(verifiedTempPath,path\)/u);
  assert.match(source, /T5_MARKET_BASELINE_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /T5_MARKET_BASELINE_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD/u);
});

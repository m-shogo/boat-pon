import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/audit-odds-timeseries-storage.ts", "utf8");

test("odds timeseries storage audit verifies canonical DB identity before opening SQLite", () => {
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");

  assert.ok(identity >= 0);
  assert.ok(open > identity, "storage audit must only open the verified canonical DB path");
  assert.match(source, /ODDS_TIMESERIES_STORAGE_AUDIT_DB_IDENTITY_INVALID/);
  assert.match(source, /PRAGMA query_only=ON/);
});

test("odds timeseries storage audit does not expose or reuse the configured private DB path", () => {
  assert.match(source, /ODDS_TIMESERIES_STORAGE_AUDIT_DB_UNAVAILABLE/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
  assert.match(source, /statSync\(verifiedDbPath\)/);
  assert.doesNotMatch(source, /statSync\(DB_PATH\)/);
});

test("odds timeseries storage audit validates existing reports before replacement", () => {
  const jsonPreflight = source.indexOf("verifyExistingOutput(OUT_JSON");
  const mdPreflight = source.indexOf("verifyExistingOutput(OUT_MD");
  const jsonPublish = source.indexOf("atomicPublish(OUT_JSON");
  const mdPublish = source.indexOf("atomicPublish(OUT_MD");

  assert.ok(jsonPreflight >= 0 && mdPreflight > jsonPreflight);
  assert.ok(jsonPublish > mdPreflight && mdPublish > jsonPublish);
  assert.match(source, /ODDS_TIMESERIES_STORAGE_PREEXISTING_JSON_IDENTITY_INVALID/);
  assert.match(source, /ODDS_TIMESERIES_STORAGE_PREEXISTING_MD_IDENTITY_INVALID/);
});

test("odds timeseries storage audit publishes through fsynced identity-checked atomic replacement", () => {
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, identityErrorCode)", fsync);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", identity);

  assert.ok(create >= 0 && fsync > create && identity > fsync && rename > identity);
  assert.match(source, /ODDS_TIMESERIES_STORAGE_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /ODDS_TIMESERIES_STORAGE_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
});

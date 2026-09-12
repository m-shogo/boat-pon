import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/plan-odds-timeseries-compaction.ts", "utf8");

test("odds timeseries compaction plan verifies canonical DB identity before opening SQLite", () => {
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");

  assert.ok(identity >= 0, "canonical single-link regular-file identity must be checked");
  assert.ok(open > identity, "SQLite must only open the verified canonical path");
  assert.match(source, /ODDS_TIMESERIES_COMPACTION_PLAN_DB_IDENTITY_INVALID/);
  assert.match(source, /PRAGMA query_only=ON/);
});

test("odds timeseries compaction plan does not expose configured private DB paths", () => {
  assert.match(source, /ODDS_TIMESERIES_COMPACTION_PLAN_DB_UNAVAILABLE/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
  assert.match(source, /statSync\(verifiedDbPath\)/);
  assert.doesNotMatch(source, /statSync\(DB_PATH\)/);
});

test("odds timeseries compaction plan validates existing reports before replacement", () => {
  const jsonPreflight = source.indexOf("verifyExistingOutput(OUT_JSON");
  const mdPreflight = source.indexOf("verifyExistingOutput(OUT_MD");
  const jsonPublish = source.indexOf("atomicPublish(\n  OUT_JSON");
  const mdPublish = source.indexOf("atomicPublish(\n  OUT_MD");

  assert.ok(jsonPreflight >= 0 && mdPreflight > jsonPreflight);
  assert.ok(jsonPublish > mdPreflight && mdPublish > jsonPublish);
  assert.match(source, /ODDS_TIMESERIES_COMPACTION_PLAN_PREEXISTING_JSON_IDENTITY_INVALID/);
  assert.match(source, /ODDS_TIMESERIES_COMPACTION_PLAN_PREEXISTING_MD_IDENTITY_INVALID/);
});

test("odds timeseries compaction plan revalidates report destinations before fsynced atomic replacement", () => {
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempIdentityErrorCode)", fsync);
  const destinationIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationIdentityErrorCode)", tempIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);

  assert.ok(
    create >= 0 &&
      fsync > create &&
      tempIdentity > fsync &&
      destinationIdentity > tempIdentity &&
      rename > destinationIdentity,
  );
  assert.match(source, /ODDS_TIMESERIES_COMPACTION_PLAN_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /ODDS_TIMESERIES_COMPACTION_PLAN_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(source, /ODDS_TIMESERIES_COMPACTION_PLAN_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /ODDS_TIMESERIES_COMPACTION_PLAN_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
});

test("odds timeseries compaction plan remains planning-only and read-only", () => {
  assert.match(source, /safety: \{ readOnly: true, dbWrites: false, deletePerformed: false, vacuumPerformed: false \}/);
  assert.doesNotMatch(source, /db\.exec\([^)]*DELETE/i);
  assert.doesNotMatch(source, /db\.exec\([^)]*VACUUM/i);
});

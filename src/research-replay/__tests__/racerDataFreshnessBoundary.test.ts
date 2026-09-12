import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCE_PATH = "scripts/report-racer-data-freshness.ts";

test("racer freshness report verifies the database before query-only read access", () => {
  const source = readFileSync(SOURCE_PATH, "utf8");

  const identity = source.indexOf(
    'assertCanonicalSingleLinkRegularFile(\n    DB_PATH,\n    "RACER_FRESHNESS_DB_IDENTITY_INVALID"',
  );
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })", identity);
  const queryOnly = source.indexOf("PRAGMA query_only = ON", open);
  assert.ok(identity >= 0 && open > identity && queryOnly > open);
});

test("racer freshness report verifies optional logs before reading them", () => {
  const source = readFileSync(SOURCE_PATH, "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(path, identityErrorCode\)/u);
  assert.match(source, /RACER_FRESHNESS_LOG_IDENTITY_INVALID/u);
  assert.match(source, /RACER_FRESHNESS_ERROR_LOG_IDENTITY_INVALID/u);
  assert.match(source, /statSync\(verifiedPath\)/u);
  assert.match(source, /readFileSync\(verifiedPath, "utf8"\)/u);
});

test("racer freshness report publishes through fsynced verified temp files and rechecks existing destinations", () => {
  const source = readFileSync(SOURCE_PATH, "utf8");

  const tempOpen = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)", tempOpen);
  const tempIdentity = source.indexOf(
    "assertCanonicalSingleLinkRegularFile(tempPath, tempIdentityErrorCode)",
    fsync,
  );
  const destinationGuard = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf(
    "assertCanonicalSingleLinkRegularFile(path, destinationIdentityErrorCode)",
    destinationGuard,
  );
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);

  assert.ok(
    tempOpen >= 0 &&
      fsync > tempOpen &&
      tempIdentity > fsync &&
      destinationGuard > tempIdentity &&
      destinationIdentity > destinationGuard &&
      rename > destinationIdentity,
  );
  assert.match(source, /RACER_FRESHNESS_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /RACER_FRESHNESS_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.doesNotMatch(source, /writeFileSync\(REPORT_(?:MD|JSON),/u);
});

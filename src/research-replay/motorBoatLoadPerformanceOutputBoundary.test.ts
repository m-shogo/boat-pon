import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-motor-boat-load-performance.ts", "utf8");

test("motor boat load performance keeps a canonical read-only database boundary", () => {
  assert.match(source, /MOTOR_BOAT_LOAD_PERFORMANCE_DB_IDENTITY_INVALID/u);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only = ON/u);
});

test("motor boat load performance preflights the complete paired destination set before first replacement", () => {
  const reportsIdentity = source.indexOf("MOTOR_BOAT_LOAD_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const preflightJson = source.indexOf("verifyExistingOutput(OUT_JSON", reportsIdentity);
  const preflightMd = source.indexOf("verifyExistingOutput(OUT_MD", preflightJson);
  const firstPublish = source.indexOf("atomicPublish(", preflightMd);
  assert.ok(reportsIdentity >= 0 && preflightJson > reportsIdentity && preflightMd > preflightJson && firstPublish > preflightMd);
  assert.match(source, /MOTOR_BOAT_LOAD_PREEXISTING_JSON_IDENTITY_INVALID/u);
  assert.match(source, /MOTOR_BOAT_LOAD_PREEXISTING_MD_IDENTITY_INVALID/u);
});

test("motor boat load performance publishes through verified atomic temp files with destination and parent handoff guards", () => {
  assert.match(source, /MOTOR_BOAT_LOAD_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /MOTOR_BOAT_LOAD_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /MOTOR_BOAT_LOAD_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /MOTOR_BOAT_LOAD_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/u);

  const helper = source.indexOf("function atomicPublish(");
  const parentIdentity = source.indexOf("MOTOR_BOAT_LOAD_PUBLISH_PARENT_IDENTITY_INVALID", helper);
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempIdentityErrorCode)", fsync);
  const destinationGuard = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf(
    "assertCanonicalSingleLinkRegularFile(path, destinationIdentityErrorCode)",
    destinationGuard,
  );
  const parentHandoff = source.indexOf("MOTOR_BOAT_LOAD_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);

  assert.ok(
    helper >= 0 &&
      parentIdentity > helper &&
      create > parentIdentity &&
      fsync > create &&
      tempIdentity > fsync &&
      destinationGuard > tempIdentity &&
      destinationIdentity > destinationGuard &&
      parentHandoff > destinationIdentity &&
      rename > parentHandoff,
  );
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD/u);
});

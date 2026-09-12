import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-point-in-time-leak-impact.ts", "utf8");

test("point-in-time leak impact report verifies one canonical read-only DB before analysis", () => {
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  const rows = source.indexOf("const rows = db.prepare");
  const noBreakdown = source.indexOf("const totalBuyNoBreakdown = (db.prepare");

  assert.ok(identity >= 0 && open > identity, "SQLite must open only after canonical identity verification");
  assert.ok(rows > open && noBreakdown > rows, "both report queries must use the same verified DB handle");
  assert.match(source, /POINT_IN_TIME_LEAK_IMPACT_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.equal((source.match(/new DatabaseSync\(/g) ?? []).length, 1, "report must not re-open an unverified DB later");
});

test("point-in-time leak impact report fails closed without exposing configured DB paths", () => {
  assert.match(source, /POINT_IN_TIME_LEAK_IMPACT_PRIMARY_DB_MISSING/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

test("point-in-time leak impact validates existing reports and publishes atomically", () => {
  const preflightJson = source.indexOf("verifyExistingOutput(OUT_JSON");
  const preflightMd = source.indexOf("verifyExistingOutput(OUT_MD");
  const jsonPublish = source.indexOf("atomicPublish(\n  OUT_JSON");
  const mdPublish = source.indexOf("atomicPublish(\n  OUT_MD");
  assert.ok(preflightJson >= 0 && preflightMd > preflightJson && jsonPublish > preflightMd && mdPublish > jsonPublish);

  const create = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, identityErrorCode)", fsync);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", identity);
  assert.ok(create >= 0 && fsync > create && identity > fsync && rename > identity);

  assert.match(source, /POINT_IN_TIME_LEAK_IMPACT_PREEXISTING_JSON_IDENTITY_INVALID/);
  assert.match(source, /POINT_IN_TIME_LEAK_IMPACT_PREEXISTING_MD_IDENTITY_INVALID/);
  assert.match(source, /POINT_IN_TIME_LEAK_IMPACT_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /POINT_IN_TIME_LEAK_IMPACT_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
});

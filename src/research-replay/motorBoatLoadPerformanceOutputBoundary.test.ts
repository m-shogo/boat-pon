import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-motor-boat-load-performance.ts", "utf8");

test("motor boat load performance keeps a canonical read-only database boundary", () => {
  assert.match(source, /MOTOR_BOAT_LOAD_PERFORMANCE_DB_IDENTITY_INVALID/u);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only = ON/u);
});

test("motor boat load performance publishes reports through exclusive verified temp files", () => {
  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(source, /fsyncSync\(fd\)/u);
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(tempPath, errorCode\)/u);
  assert.match(source, /renameSync\(verifiedTempPath, path\)/u);
  assert.match(source, /MOTOR_BOAT_LOAD_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /MOTOR_BOAT_LOAD_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD/u);
});

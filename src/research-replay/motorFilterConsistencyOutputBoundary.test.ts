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

test("motor filter consistency publishes both outputs through exclusive verified temp files", () => {
  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(source, /fsyncSync\(fd\)/u);
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(tempPath, errorCode\)/u);
  assert.match(source, /renameSync\(verifiedTempPath, path\)/u);
  assert.match(source, /MOTOR_FILTER_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /MOTOR_FILTER_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD/u);
});

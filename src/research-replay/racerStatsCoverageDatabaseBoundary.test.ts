import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync("scripts/check-racer-stats-coverage.ts", "utf-8");

test("racer stats coverage reads only a verified canonical research database", () => {
  const missing = source.indexOf("RACER_STATS_COVERAGE_PRIMARY_DB_MISSING");
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");

  assert.ok(missing >= 0);
  assert.ok(identity > missing, "database identity must be checked after the opaque missing-file gate");
  assert.ok(open > identity, "SQLite must open only the verified canonical path");
  assert.match(source, /RACER_STATS_COVERAGE_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH/);
});

test("racer stats coverage remains a read-only diagnostic", () => {
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|DROP|REPLACE|CREATE|ALTER)\b/i);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-motor-boat-load-performance.ts", "utf8");

test("motor/boat load performance audit verifies the canonical DB before read-only SQLite access", () => {
  const verifyIndex = source.indexOf("assertCanonicalSingleLinkRegularFile(");
  const openIndex = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");

  assert.ok(verifyIndex >= 0, "canonical database identity guard must exist");
  assert.ok(openIndex > verifyIndex, "SQLite must open only after canonical identity verification");
  assert.match(source, /PRAGMA query_only = ON/);
});

test("motor/boat load performance audit does not expose the configured private DB path", () => {
  assert.match(source, /MOTOR_BOAT_LOAD_PERFORMANCE_DB_UNAVAILABLE/);
  assert.doesNotMatch(source, /DB not found:\s*\$\{DB_PATH\}/);
});

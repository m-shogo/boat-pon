import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/audit-bet-type-coverage.ts", "utf8");

test("bet-type coverage audit verifies canonical read-only DB identity", () => {
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(identity >= 0);
  assert.ok(open > identity);
  assert.match(source, /PRAGMA query_only = ON/);
});

test("bet-type coverage reports never expose configured DB paths", () => {
  assert.match(source, /const REPORT_DB_LABEL = "canonical research database"/);
  assert.match(source, /dbPath: REPORT_DB_LABEL/);
  assert.doesNotMatch(source, /dbPath: DB_PATH/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
  assert.match(source, /research database unavailable/);
});

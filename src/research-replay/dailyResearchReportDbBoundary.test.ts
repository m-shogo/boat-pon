import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("daily research report DB is canonical, read-only, and query-only", () => {
  const source = readFileSync("scripts/daily-research-report.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(/);
  assert.match(source, /DAILY_RESEARCH_REPORT_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH, \{ readOnly: true \}\)/);
});

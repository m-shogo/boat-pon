import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("buy misses report verifies primary database identity before opening read-only", () => {
  const source = readFileSync("scripts/report-buy-misses.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /BUY_MISSES_REPORT_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /BUY_MISSES_REPORT_PRIMARY_DB_MISSING/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

test("buy misses report excludes unsettled BUY rows from the miss cohort", () => {
  const source = readFileSync("scripts/report-buy-misses.ts", "utf8");

  assert.match(source, /"decision = 'BUY'"/);
  assert.match(source, /"returned = 0"/);
  assert.match(source, /"result IS NOT NULL"/);
  assert.match(source, /"selection != result"/);
  assert.doesNotMatch(source, /result IS NULL OR selection != result/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("data quality outcomes report verifies primary database identity before opening read-only", () => {
  const source = readFileSync("scripts/report-data-quality-outcomes.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /DATA_QUALITY_OUTCOMES_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /DATA_QUALITY_OUTCOMES_PRIMARY_DB_MISSING/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

test("data quality outcomes report keeps ROI denominators restricted to settled non-returned rows", () => {
  const source = readFileSync("scripts/report-data-quality-outcomes.ts", "utf8");

  assert.match(source, /SUM\(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END\) AS settled/);
  assert.match(source, /SUM\(CASE WHEN selection = result AND returned = 0 THEN 1 ELSE 0 END\) AS hits/);
  assert.match(source, /NULLIF\(settled, 0\)/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("calibration report verifies primary database identity before opening read-only", () => {
  const source = readFileSync("scripts/report-calibration.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /CALIBRATION_REPORT_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH/);
});

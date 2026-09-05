import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("model version simple report verifies primary database identity before opening read-only", () => {
  const source = readFileSync("scripts/report-model-version-simple.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /MODEL_VERSION_REPORT_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH/);
});

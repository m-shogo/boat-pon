import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("ROI explorer verifies primary database identity before opening read-only", () => {
  const source = readFileSync("scripts/explore-roi.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /ROI_EXPLORER_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("candidate selection audit verifies primary database identity before opening read-only", () => {
  const source = readFileSync("scripts/audit-candidate-selection.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /CANDIDATE_SELECTION_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH/);
});

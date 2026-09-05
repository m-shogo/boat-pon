import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("shadow top1 backtest verifies primary database identity before read-only open", () => {
  const source = readFileSync("scripts/backtest-shadow-top1.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /SHADOW_TOP1_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /new DatabaseSync\("data\/boat\.sqlite"/);
});

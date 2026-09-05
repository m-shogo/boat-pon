import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync("scripts/walk-forward-history.ts", "utf8");

test("walk-forward history verifies primary database identity before opening sqlite", () => {
  const verify = source.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = source.indexOf("new DatabaseSync(primaryDbPath, { readOnly: true })");
  assert.ok(verify >= 0);
  assert.ok(open > verify);
  assert.match(source, /PRAGMA query_only = ON/);
});

test("walk-forward history keeps missing official hit payouts fail-closed", () => {
  assert.match(source, /missingPayoutHits > 0 \|\| roi == null/);
  assert.match(source, /return "incomplete"/);
  assert.match(source, /row\.missingPayoutHits/);
});

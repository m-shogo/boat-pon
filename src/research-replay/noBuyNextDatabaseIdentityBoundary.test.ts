import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-no-buy-next.ts", "utf-8");

test("no-buy next research verifies primary DB identity before opening SQLite", () => {
  const verify = source.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0, "primary DB identity guard must exist");
  assert.ok(open > verify, "SQLite must open only after canonical identity verification");
});

test("no-buy next research keeps SQLite query-only and remains analysis-only", () => {
  assert.match(source, /PRAGMA query_only = ON/);
  assert.match(source, /readOnly: true/);
  assert.match(source, /これはedge候補であり、本物のedgeではありません/);
  assert.match(source, /本番採用しません/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-venue-monthly.ts", "utf-8");

test("venue monthly research report verifies primary DB identity before opening SQLite", () => {
  const verify = source.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");

  assert.ok(verify >= 0, "primary DB identity guard must exist");
  assert.ok(open > verify, "SQLite must open only after canonical identity verification");
});

test("venue monthly research report enforces SQLite query-only and remains read-only", () => {
  assert.match(source, /PRAGMA query_only = ON/);
  assert.match(source, /readOnly: true/);
  assert.match(source, /読み取り専用。外部アクセスなし/);
});

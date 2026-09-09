import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/audit-odds-timeseries-storage.ts", "utf8");

test("odds timeseries storage audit verifies canonical DB identity before opening SQLite", () => {
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");

  assert.ok(identity >= 0);
  assert.ok(open > identity, "storage audit must only open the verified canonical DB path");
  assert.match(source, /ODDS_TIMESERIES_STORAGE_AUDIT_DB_IDENTITY_INVALID/);
  assert.match(source, /PRAGMA query_only=ON/);
});

test("odds timeseries storage audit does not expose or reuse the configured private DB path", () => {
  assert.match(source, /ODDS_TIMESERIES_STORAGE_AUDIT_DB_UNAVAILABLE/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
  assert.match(source, /statSync\(verifiedDbPath\)/);
  assert.doesNotMatch(source, /statSync\(DB_PATH\)/);
});

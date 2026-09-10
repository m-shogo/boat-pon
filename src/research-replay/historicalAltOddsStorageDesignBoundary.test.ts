import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/design-historical-alternative-odds-storage.ts", "utf8");

test("historical alternative odds storage design verifies the research DB before opening it", () => {
  const verify = source.indexOf("assertCanonicalSingleLinkRegularFile(");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");

  assert.ok(verify >= 0, "research DB identity must be verified");
  assert.ok(open > verify, "SQLite must open only the verified research DB path");
  assert.ok(source.includes('db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;")'));
});

test("historical alternative odds storage design keeps DB failures opaque", () => {
  assert.ok(source.includes('throw new Error("HISTORICAL_ALT_ODDS_DESIGN_PRIMARY_DB_MISSING")'));
  assert.ok(source.includes('"HISTORICAL_ALT_ODDS_DESIGN_PRIMARY_DB_IDENTITY_INVALID"'));
  assert.equal(source.includes("DB not found: ${DB_PATH}"), false);
  assert.equal(source.includes("new DatabaseSync(DB_PATH"), false);
});

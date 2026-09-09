import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/validate-data.ts", "utf8");

test("data validation verifies canonical DB identity before opening SQLite", () => {
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");

  assert.ok(identity >= 0, "canonical single-link regular-file identity must be checked");
  assert.ok(open > identity, "SQLite must only open the verified canonical path");
  assert.match(source, /DATA_VALIDATION_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /PRAGMA query_only = ON/);
});

test("data validation does not expose configured private DB paths", () => {
  assert.match(source, /DATA_VALIDATION_DB_MISSING/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
  assert.doesNotMatch(source, /dbPath: DB_PATH/);
  assert.match(source, /dbPath: DB_SOURCE/);
});

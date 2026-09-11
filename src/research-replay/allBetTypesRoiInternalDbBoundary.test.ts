import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-all-bet-types-roi-internal.ts", "utf8");

test("all-bet-types ROI internal verifies DB identity and enforces query_only before analysis", () => {
  const identity = source.indexOf("ALL_BET_TYPES_ROI_DB_IDENTITY_INVALID");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  const queryOnly = source.indexOf("PRAGMA query_only = ON");
  const firstQuery = source.indexOf("db.prepare(");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/u);
  assert.ok(identity >= 0, "DB identity error code must exist");
  assert.ok(open > identity, "DB identity must be verified before SQLite open");
  assert.ok(queryOnly > open, "query_only must be enabled after read-only open");
  assert.ok(firstQuery > queryOnly, "query_only must be enabled before analysis queries");
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/u);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH, \{ readOnly: true \}\)/u);
});

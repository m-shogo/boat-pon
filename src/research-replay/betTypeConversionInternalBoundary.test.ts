import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const internal = readFileSync("scripts/analyze-123-bet-type-conversion-internal.ts", "utf8");

test("123 bet-type internal analyzer cannot bypass canonical preflight by direct execution", () => {
  assert.match(internal, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(internal, /process\.argv\[1\]/);
  assert.match(internal, /BET_TYPE_CONVERSION_INTERNAL_DIRECT_EXECUTION_FORBIDDEN/);
});

test("123 bet-type internal analyzer revalidates the DB before ROI analysis", () => {
  const identity = internal.indexOf("assertCanonicalSingleLinkRegularFile(");
  const open = internal.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  const analysis = internal.indexOf("function analyzeCondition");

  assert.ok(identity >= 0 && open > identity, "internal SQLite open must use the verified canonical path");
  assert.ok(analysis > open, "ROI/verdict analysis must remain downstream of DB verification");
  assert.match(internal, /BET_TYPE_CONVERSION_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(internal, /PRAGMA query_only = ON/);
});

test("123 bet-type internal analyzer does not expose the configured DB path", () => {
  assert.match(internal, /BET_TYPE_CONVERSION_PRIMARY_DB_MISSING/);
  assert.doesNotMatch(internal, /DB not found: \$\{DB_PATH\}/);
  assert.doesNotMatch(internal, /DB: \$\{DB_PATH\}/);
  assert.match(internal, /DB: \$\{DB_SOURCE\}/);
});

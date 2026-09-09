import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const raw = readFileSync("scripts/analyze-one-four-structure-raw.ts", "utf8");

test("one-four guarded analyzer revalidates the canonical DB immediately before internal import", () => {
  assert.match(raw, /ONE_FOUR_STRUCTURE_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /ONE_FOUR_STRUCTURE_DB_MISSING/);
  assert.match(raw, /assertCanonicalSingleLinkRegularFile\(/);
  assert.match(raw, /ONE_FOUR_STRUCTURE_DB_IDENTITY_INVALID/);
  assert.match(raw, /process\.env\.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /DB not found: \$\{dbPath\}/);

  const directExecutionGuard = raw.indexOf("ONE_FOUR_STRUCTURE_RAW_DIRECT_EXECUTION_FORBIDDEN");
  const identityRecheck = raw.indexOf("process.env.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile");
  const internalImport = raw.indexOf("await import(\"./analyze-one-four-structure-internal\")");

  assert.ok(directExecutionGuard >= 0);
  assert.ok(identityRecheck > directExecutionGuard);
  assert.ok(internalImport > identityRecheck);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const raw = readFileSync("scripts/analyze-all-bet-types-roi-raw.ts", "utf8");

test("all-bet-types guarded analyzer revalidates the canonical DB immediately before internal import", () => {
  assert.match(raw, /ALL_BET_TYPES_ROI_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /ALL_BET_TYPES_ROI_DB_MISSING/);
  assert.match(raw, /assertCanonicalSingleLinkRegularFile\(/);
  assert.match(raw, /ALL_BET_TYPES_ROI_DB_IDENTITY_INVALID/);
  assert.match(raw, /process\.env\.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /DB not found: \$\{dbPath\}/);

  const directExecutionGuard = raw.indexOf("ALL_BET_TYPES_ROI_RAW_DIRECT_EXECUTION_FORBIDDEN");
  const identityRecheck = raw.indexOf("process.env.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile");
  const internalImport = raw.indexOf("await import(\"./analyze-all-bet-types-roi-internal\")");

  assert.ok(directExecutionGuard >= 0);
  assert.ok(identityRecheck > directExecutionGuard);
  assert.ok(internalImport > identityRecheck);
});

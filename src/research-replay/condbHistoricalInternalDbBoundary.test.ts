import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const raw = readFileSync("scripts/analyze-condb-switch-historical-closing-odds-raw.ts", "utf8");

test("condB guarded analyzer revalidates the canonical DB immediately before internal import", () => {
  assert.match(raw, /CONDB_SWITCH_HISTORICAL_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /CONDB_SWITCH_HISTORICAL_DB_MISSING/);
  assert.match(raw, /assertCanonicalSingleLinkRegularFile\(/);
  assert.match(raw, /CONDB_SWITCH_HISTORICAL_DB_IDENTITY_INVALID/);
  assert.match(raw, /process\.env\.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /DB not found: \$\{dbPath\}/);

  const directExecutionGuard = raw.indexOf("CONDB_SWITCH_HISTORICAL_RAW_DIRECT_EXECUTION_FORBIDDEN");
  const identityRecheck = raw.indexOf("process.env.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile");
  const internalImport = raw.indexOf("await import(\"./analyze-condb-switch-historical-closing-odds-internal\")");

  assert.ok(directExecutionGuard >= 0);
  assert.ok(identityRecheck > directExecutionGuard);
  assert.ok(internalImport > identityRecheck);
});

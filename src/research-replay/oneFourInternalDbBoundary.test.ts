import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-one-four-structure.ts", "utf8");
const raw = readFileSync("scripts/analyze-one-four-structure-raw.ts", "utf8");

test("one-four canonical entrypoint revalidates DB after payout audit before internal analysis", () => {
  const audit = entrypoint.indexOf("audit !== 0");
  const identityRecheck = entrypoint.indexOf("ONE_FOUR_STRUCTURE_DB_HANDOFF_IDENTITY_INVALID");
  const internalImport = entrypoint.indexOf('await import("./analyze-one-four-structure-internal")');

  assert.ok(audit >= 0);
  assert.ok(identityRecheck > audit, "DB identity must be revalidated only after payout audit passes");
  assert.ok(internalImport > identityRecheck, "internal analyzer must load only after verified DB handoff");
  assert.match(entrypoint, /ONE_FOUR_STRUCTURE_DB_MISSING/);
  assert.match(entrypoint, /process\.env\.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(entrypoint, /analyze-one-four-structure-raw/);
});

test("one-four guarded raw compatibility module cannot bypass canonical payout audit", () => {
  assert.match(raw, /ONE_FOUR_STRUCTURE_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-one-four-structure"\)/);
  assert.doesNotMatch(raw, /analyze-one-four-structure-internal/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /DatabaseSync/);
});

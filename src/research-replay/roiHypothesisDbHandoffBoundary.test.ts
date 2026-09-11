import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-hypothesis-sets.ts", "utf8");
const raw = readFileSync("scripts/analyze-roi-hypothesis-sets-raw.ts", "utf8");

test("ROI hypothesis entrypoint revalidates DB identity after settlement preflight before internal analysis", () => {
  const close = entrypoint.indexOf("db.close()");
  const handoff = entrypoint.indexOf("ROI_HYPOTHESIS_DB_HANDOFF_IDENTITY_INVALID");
  const internalImport = entrypoint.indexOf('await import("./analyze-roi-hypothesis-sets-internal")');

  assert.ok(close >= 0);
  assert.ok(handoff > close, "DB identity must be revalidated after the preflight DB closes");
  assert.ok(internalImport > handoff, "internal analyzer must load only after DB handoff revalidation");
  assert.match(entrypoint, /process\.env\.BOAT_PON_DB_PATH = handoffDbPath/);
  assert.doesNotMatch(entrypoint, /analyze-roi-hypothesis-sets-raw/);
});

test("ROI hypothesis guarded raw compatibility module routes through canonical DB and settlement preflight", () => {
  const canonical = raw.indexOf('await import("./analyze-roi-hypothesis-sets")');

  assert.ok(canonical >= 0);
  assert.match(raw, /ROI_HYPOTHESIS_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.doesNotMatch(raw, /ROI_HYPOTHESIS_DB_IDENTITY_INVALID/);
  assert.doesNotMatch(raw, /ROI_HYPOTHESIS_DB_MISSING/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /analyze-roi-hypothesis-sets-internal/);
});

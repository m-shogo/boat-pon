import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/search-roi-patterns.ts", "utf8");
const raw = readFileSync("scripts/search-roi-patterns-raw.ts", "utf8");

test("ROI pattern entrypoint revalidates DB identity after settlement preflight before internal analysis", () => {
  const close = entrypoint.indexOf("db.close()");
  const handoff = entrypoint.indexOf("ROI_PATTERN_DB_HANDOFF_IDENTITY_INVALID");
  const internalImport = entrypoint.indexOf('await import("./search-roi-patterns-internal")');

  assert.ok(close >= 0);
  assert.ok(handoff > close, "DB identity must be revalidated after the settlement preflight DB closes");
  assert.ok(internalImport > handoff, "internal analyzer must load only after DB handoff revalidation");
  assert.match(entrypoint, /process\.env\.BOAT_PON_DB_PATH = handoffDbPath/);
  assert.doesNotMatch(entrypoint, /search-roi-patterns-raw/);
});

test("ROI pattern guarded raw compatibility module routes through canonical DB and settlement preflight", () => {
  const canonical = raw.indexOf('await import("./search-roi-patterns")');

  assert.ok(canonical >= 0);
  assert.match(raw, /ROI_PATTERN_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.doesNotMatch(raw, /ROI_PATTERN_DB_IDENTITY_INVALID/);
  assert.doesNotMatch(raw, /ROI_PATTERN_DB_MISSING/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /search-roi-patterns-internal/);
});

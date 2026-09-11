import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/search-roi-patterns.ts", "utf8");
const raw = readFileSync("scripts/search-roi-patterns-raw.ts", "utf8");

test("ROI pattern entrypoint revalidates DB identity after settlement preflight and before internal analysis", () => {
  const close = entrypoint.indexOf("db.close()");
  const handoff = entrypoint.indexOf("ROI_PATTERN_DB_HANDOFF_IDENTITY_INVALID");
  const mdPreflight = entrypoint.indexOf("ROI_PATTERN_MD_PREEXISTING_IDENTITY_INVALID", handoff);
  const jsonPreflight = entrypoint.indexOf("ROI_PATTERN_JSON_PREEXISTING_IDENTITY_INVALID", handoff);
  const childHandoff = entrypoint.indexOf("ROI_PATTERN_DB_CHILD_HANDOFF_IDENTITY_INVALID", jsonPreflight);
  const childEnv = entrypoint.indexOf("process.env.BOAT_PON_DB_PATH = childDbPath", childHandoff);
  const internalImport = entrypoint.indexOf('await import("./search-roi-patterns-internal")');

  assert.ok(close >= 0);
  assert.ok(handoff > close, "DB identity must be revalidated after the settlement preflight DB closes");
  assert.ok(mdPreflight > handoff && jsonPreflight > handoff, "existing report paths must be verified after the DB handoff");
  assert.ok(childHandoff > mdPreflight && childHandoff > jsonPreflight, "DB identity must be reverified after report-path checks");
  assert.ok(childEnv > childHandoff, "only the freshly reverified child DB path may be exported");
  assert.ok(internalImport > childEnv, "internal analyzer must load only after final DB handoff revalidation");
  assert.match(entrypoint, /process\.env\.BOAT_PON_DB_PATH = handoffDbPath/);
  assert.match(entrypoint, /process\.env\.BOAT_PON_DB_PATH = childDbPath/);
  assert.doesNotMatch(entrypoint, /search-roi-patterns-raw/);
});

test("ROI pattern entrypoint protects report identities around the legacy internal writer", () => {
  const mdPreflight = entrypoint.indexOf("ROI_PATTERN_MD_PREEXISTING_IDENTITY_INVALID");
  const jsonPreflight = entrypoint.indexOf("ROI_PATTERN_JSON_PREEXISTING_IDENTITY_INVALID");
  const internalImport = entrypoint.indexOf('await import("./search-roi-patterns-internal")');
  const mdPostflight = entrypoint.indexOf("ROI_PATTERN_MD_OUTPUT_IDENTITY_INVALID", internalImport);
  const jsonPostflight = entrypoint.indexOf("ROI_PATTERN_JSON_OUTPUT_IDENTITY_INVALID", internalImport);

  assert.ok(mdPreflight >= 0 && jsonPreflight >= 0);
  assert.ok(mdPreflight < internalImport && jsonPreflight < internalImport, "existing report paths must be guarded before internal writes");
  assert.ok(mdPostflight > internalImport && jsonPostflight > internalImport, "generated reports must be canonical single-link files before success");
  assert.match(entrypoint, /ROI_PATTERN_MD_OUTPUT_MISSING/);
  assert.match(entrypoint, /ROI_PATTERN_JSON_OUTPUT_MISSING/);
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

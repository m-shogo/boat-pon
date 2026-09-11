import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wrapper = readFileSync("scripts/analyze-all-bet-types-roi.ts", "utf8");
const raw = readFileSync("scripts/analyze-all-bet-types-roi-raw.ts", "utf8");

test("all-bet-types canonical analyzer revalidates the DB immediately before internal execution", () => {
  assert.match(wrapper, /ALL_BET_TYPES_ROI_DB_HANDOFF_IDENTITY_INVALID/);
  assert.match(wrapper, /assertCanonicalSingleLinkRegularFile\(/);
  assert.match(wrapper, /process\.env\.BOAT_PON_DB_PATH = handoffDbPath/);

  const gate = wrapper.indexOf("audit !== 0");
  const identityRecheck = wrapper.indexOf("ALL_BET_TYPES_ROI_DB_HANDOFF_IDENTITY_INVALID");
  const internalRun = wrapper.indexOf('run("scripts/analyze-all-bet-types-roi-internal.ts")');

  assert.ok(gate >= 0);
  assert.ok(identityRecheck > gate, "DB handoff identity must be verified only after payout completeness passes");
  assert.ok(internalRun > identityRecheck, "internal analyzer must run only after canonical DB identity verification");
});

test("all-bet-types canonical analyzer protects generated report identities around internal execution", () => {
  const mdPreflight = wrapper.indexOf("ALL_BET_TYPES_ROI_MD_PREEXISTING_IDENTITY_INVALID");
  const jsonPreflight = wrapper.indexOf("ALL_BET_TYPES_ROI_JSON_PREEXISTING_IDENTITY_INVALID");
  const internalRun = wrapper.indexOf('run("scripts/analyze-all-bet-types-roi-internal.ts")');
  const outputMissing = wrapper.indexOf("ALL_BET_TYPES_ROI_OUTPUT_MISSING");
  const mdPostflight = wrapper.indexOf("ALL_BET_TYPES_ROI_MD_OUTPUT_IDENTITY_INVALID");
  const jsonPostflight = wrapper.indexOf("ALL_BET_TYPES_ROI_JSON_OUTPUT_IDENTITY_INVALID");

  assert.ok(mdPreflight >= 0 && jsonPreflight >= 0);
  assert.ok(mdPreflight < internalRun && jsonPreflight < internalRun, "existing report paths must be identity-checked before legacy writes");
  assert.ok(outputMissing > internalRun, "successful internal execution must still prove both outputs exist");
  assert.ok(mdPostflight > outputMissing && jsonPostflight > outputMissing, "generated outputs must be canonical single-link files before success");
});

test("all-bet-types raw compatibility path cannot load the internal analyzer directly", () => {
  assert.match(raw, /ALL_BET_TYPES_ROI_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-all-bet-types-roi"\)/);
  assert.doesNotMatch(raw, /analyze-all-bet-types-roi-internal/);
});

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

test("all-bet-types raw compatibility path cannot load the internal analyzer directly", () => {
  assert.match(raw, /ALL_BET_TYPES_ROI_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-all-bet-types-roi"\)/);
  assert.doesNotMatch(raw, /analyze-all-bet-types-roi-internal/);
});

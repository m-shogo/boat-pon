import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-all-bet-types-roi.ts", "utf8");

test("all-bet-types ROI revalidates DB identity after payout preflight and immediately before isolated internal analysis", () => {
  const preflight = source.indexOf('run("scripts/audit-all-bet-types-payout-completeness.ts")');
  const handoff = source.indexOf("ALL_BET_TYPES_ROI_DB_HANDOFF_IDENTITY_INVALID");
  const childHandoff = source.indexOf("ALL_BET_TYPES_ROI_DB_CHILD_HANDOFF_IDENTITY_INVALID");
  const workspace = source.indexOf("mkdtempSync(", childHandoff);
  const launchIdentity = source.indexOf("ALL_BET_TYPES_ROI_DB_CHILD_LAUNCH_IDENTITY_INVALID", workspace);
  const internal = source.indexOf("const analysis = spawnSync", launchIdentity);

  assert.ok(preflight >= 0);
  assert.ok(handoff > preflight, "DB identity must be revalidated after payout completeness preflight");
  assert.ok(childHandoff > handoff, "DB identity must be revalidated again before isolated workspace setup");
  assert.ok(workspace > childHandoff, "isolated workspace must follow child-handoff verification");
  assert.ok(launchIdentity > workspace, "DB identity must be revalidated after workspace setup and immediately before child launch");
  assert.ok(internal > launchIdentity, "internal analysis must run only after launch-time verified DB handoff");
  assert.match(source, /BOAT_PON_DB_PATH: launchDbPath/);
  assert.doesNotMatch(source, /process\.env\.BOAT_PON_DB_PATH = handoffDbPath/);
  assert.doesNotMatch(source, /BOAT_PON_DB_PATH: childDbPath/);
  assert.doesNotMatch(source, /analyze-all-bet-types-roi-raw/);
});

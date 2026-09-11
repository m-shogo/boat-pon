import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wrapper = readFileSync("scripts/analyze-all-bet-types-roi.ts", "utf8");
const raw = readFileSync("scripts/analyze-all-bet-types-roi-raw.ts", "utf8");
const internal = readFileSync("scripts/analyze-all-bet-types-roi-internal.ts", "utf8");

test("all-bet-types ROI canonical entrypoint runs isolated internal analysis only after payout audit and launch-time DB handoff", () => {
  const audit = wrapper.indexOf("audit-all-bet-types-payout-completeness.ts");
  const gate = wrapper.indexOf("audit !== 0");
  const identity = wrapper.indexOf("ALL_BET_TYPES_ROI_DB_HANDOFF_IDENTITY_INVALID");
  const launchIdentity = wrapper.indexOf("ALL_BET_TYPES_ROI_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const internalRun = wrapper.indexOf("const analysis = spawnSync", launchIdentity);
  assert.ok(audit >= 0);
  assert.ok(gate > audit);
  assert.ok(identity > gate, "DB handoff must remain downstream of the payout-completeness gate");
  assert.ok(launchIdentity > identity, "DB identity must be revalidated again immediately before child launch");
  assert.ok(internalRun > launchIdentity, "internal analysis must run only after launch-time canonical DB verification");
  assert.match(wrapper, /cwd: workspace/);
  assert.match(wrapper, /BOAT_PON_DB_PATH: launchDbPath/);
  assert.doesNotMatch(wrapper, /analyze-all-bet-types-roi-raw/);
});

test("all-bet-types ROI raw compatibility module cannot bypass canonical preflight", () => {
  assert.match(raw, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(raw, /process\.argv\[1\]/);
  assert.match(raw, /ALL_BET_TYPES_ROI_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-all-bet-types-roi"\)/);
  assert.doesNotMatch(raw, /analyze-all-bet-types-roi-internal/);
});

test("isolated all-bet-types ROI implementation remains research-only and read-only", () => {
  assert.match(internal, /race_payouts/);
  assert.match(internal, /new DatabaseSync/);
  assert.match(internal, /readOnly: true/);
  assert.match(internal, /PRAGMA query_only = ON/);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\(\s*[`\"']\s*(?:INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
});

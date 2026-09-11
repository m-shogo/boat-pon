import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-skip-policy-simulation.ts", "utf8");
const raw = readFileSync("scripts/analyze-roi-skip-policy-simulation-raw.ts", "utf8");

test("ROI skip-policy canonical entrypoint verifies DB identity before isolated internal analysis", () => {
  const preflight = entrypoint.indexOf('run("scripts/audit-roi-skip-policy-payout-completeness.ts")');
  const identity = entrypoint.indexOf("ROI_SKIP_POLICY_PRIMARY_DB_IDENTITY_INVALID");
  const childIdentity = entrypoint.indexOf("ROI_SKIP_POLICY_DB_CHILD_HANDOFF_IDENTITY_INVALID");
  const isolatedIdentity = entrypoint.indexOf("ROI_SKIP_POLICY_DB_ISOLATED_CHILD_HANDOFF_IDENTITY_INVALID");
  const launchIdentity = entrypoint.indexOf("ROI_SKIP_POLICY_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const internalSpawn = entrypoint.indexOf("const analysis = spawnSync", launchIdentity);

  assert.ok(preflight >= 0);
  assert.ok(identity > preflight, "DB identity must be verified after payout-completeness preflight");
  assert.ok(childIdentity > identity, "DB identity must be reverified at the child handoff");
  assert.ok(isolatedIdentity > childIdentity, "DB identity must be reverified after workspace creation");
  assert.ok(launchIdentity > isolatedIdentity, "DB identity must be reverified immediately before isolated child launch");
  assert.ok(internalSpawn > launchIdentity, "internal analyzer must start only after launch-time DB identity verification");
  assert.match(entrypoint, /BOAT_PON_DB_PATH: launchDbPath/);
  assert.doesNotMatch(entrypoint, /BOAT_PON_DB_PATH: isolatedDbPath/);
  assert.doesNotMatch(entrypoint, /BOAT_PON_DB_PATH: childDbPath/);
  assert.doesNotMatch(entrypoint, /analyze-roi-skip-policy-simulation-raw/);
});

test("ROI skip-policy guarded raw compatibility module routes through canonical preflight", () => {
  const canonical = raw.indexOf('await import("./analyze-roi-skip-policy-simulation")');

  assert.ok(canonical >= 0);
  assert.match(raw, /ROI_SKIP_POLICY_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.doesNotMatch(raw, /ROI_SKIP_POLICY_DB_IDENTITY_INVALID/);
  assert.doesNotMatch(raw, /ROI_SKIP_POLICY_DB_MISSING/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /analyze-roi-skip-policy-simulation-internal/);
});
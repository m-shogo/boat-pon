import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-skip-policy-simulation.ts", "utf8");
const raw = readFileSync("scripts/analyze-roi-skip-policy-simulation-raw.ts", "utf8");

test("ROI skip-policy canonical entrypoint verifies DB identity before guarded raw import", () => {
  const preflight = entrypoint.indexOf('run("scripts/audit-roi-skip-policy-payout-completeness.ts")');
  const identity = entrypoint.indexOf("ROI_SKIP_POLICY_PRIMARY_DB_IDENTITY_INVALID");
  const rawImport = entrypoint.indexOf('await import("./analyze-roi-skip-policy-simulation-raw")');

  assert.ok(preflight >= 0);
  assert.ok(identity > preflight, "DB identity must be verified after payout-completeness preflight");
  assert.ok(rawImport > identity, "guarded raw module must load only after DB identity verification");
});

test("ROI skip-policy guarded raw module revalidates canonical DB identity before internal analysis", () => {
  const identity = raw.indexOf("ROI_SKIP_POLICY_DB_IDENTITY_INVALID");
  const internal = raw.indexOf('await import("./analyze-roi-skip-policy-simulation-internal")');

  assert.ok(identity >= 0);
  assert.ok(internal > identity, "internal analyzer must load only after raw DB identity revalidation");
  assert.match(raw, /ROI_SKIP_POLICY_DB_MISSING/);
  assert.match(raw, /process\.env\.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile/);
});

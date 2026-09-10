/**
 * run-roi-skip-policy-simulation-safe.ts — research-only fail-closed runner
 *
 * Require complete official trifecta settlement coverage before the legacy
 * monitor-only skip-policy simulation emits payout-ROI-based policy verdicts.
 */

import { spawnSync } from "node:child_process";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

function run(script: string, env: NodeJS.ProcessEnv = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
  });

  if (result.error) {
    console.error(`[roi-skip-policy-safe-runner] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-roi-skip-policy-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[roi-skip-policy-safe-runner] FAIL CLOSED: settlement completeness preflight did not pass; policy verdicts were not generated");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ROI_SKIP_POLICY_LEGACY_PRIMARY_DB_IDENTITY_INVALID",
);

const analysis = run("scripts/analyze-roi-skip-policy-simulation-internal.ts", {
  ...process.env,
  BOAT_PON_DB_PATH: verifiedDbPath,
});
if (analysis !== 0) {
  console.error("[roi-skip-policy-safe-runner] skip-policy simulation failed after a successful payout completeness preflight");
  process.exit(analysis);
}

console.log("[roi-skip-policy-safe-runner] PASS: payout completeness preflight passed before skip-policy simulation");

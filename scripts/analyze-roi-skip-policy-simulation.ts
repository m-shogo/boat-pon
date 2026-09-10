/**
 * analyze-roi-skip-policy-simulation.ts — research-only fail-closed entrypoint
 *
 * Require complete official trifecta settlement coverage before the legacy
 * monitor-only skip-policy simulation emits payout-ROI-based policy verdicts.
 */

import { spawnSync } from "node:child_process";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[roi-skip-policy-entrypoint] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-roi-skip-policy-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[roi-skip-policy-entrypoint] FAIL CLOSED: settlement completeness preflight did not pass; policy verdicts were not generated");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
process.env.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ROI_SKIP_POLICY_PRIMARY_DB_IDENTITY_INVALID",
);

await import("./analyze-roi-skip-policy-simulation-raw");
console.log("[roi-skip-policy-entrypoint] PASS: payout completeness preflight passed before skip-policy simulation");

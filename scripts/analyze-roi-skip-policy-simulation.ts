/**
 * analyze-roi-skip-policy-simulation.ts — research-only fail-closed entrypoint
 *
 * Require complete official trifecta settlement coverage before the legacy
 * monitor-only skip-policy simulation emits payout-ROI-based policy verdicts.
 */

import { spawnSync } from "node:child_process";

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

const analysis = run("scripts/analyze-roi-skip-policy-simulation-raw.ts");
if (analysis !== 0) {
  console.error("[roi-skip-policy-entrypoint] skip-policy simulation failed after a successful payout completeness preflight");
  process.exit(analysis);
}

console.log("[roi-skip-policy-entrypoint] PASS: payout completeness preflight passed before skip-policy simulation");

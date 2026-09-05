/**
 * run-wind24-exh1-switch-deep-dive-safe.ts — research-only fail-closed runner
 *
 * Requires complete official trifecta settlement coverage before the legacy
 * deep-dive can emit ROI-based switch promotion/demotion verdicts.
 */

import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[wind24-switch-safe-runner] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-wind24-exh1-switch-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[wind24-switch-safe-runner] FAIL CLOSED: settlement completeness preflight did not pass; promotion/demotion analysis was not generated");
  process.exit(preflight);
}

const analysis = run("scripts/analyze-wind24-exh1-switch-deep-dive.ts");
if (analysis !== 0) {
  console.error("[wind24-switch-safe-runner] deep-dive failed after a successful payout completeness preflight");
  process.exit(analysis);
}

console.log("[wind24-switch-safe-runner] PASS: payout completeness preflight passed before deep-dive analysis");

/**
 * analyze-wind24-exh1-switch-deep-dive.ts — research-only fail-closed entrypoint
 *
 * The deep-dive produces ROI-based promotion/demotion verdicts. Missing official
 * trifecta settlements must never be interpreted as zero-return observations,
 * including when this file is invoked directly through npm or tsx.
 */

import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[wind24-switch] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-wind24-exh1-switch-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[wind24-switch] FAIL CLOSED: official trifecta settlement coverage is incomplete; promotion/demotion analysis was not generated");
  process.exit(preflight);
}

const analysis = run("scripts/analyze-wind24-exh1-switch-deep-dive-core.ts");
if (analysis !== 0) {
  console.error("[wind24-switch] deep-dive failed after a successful settlement completeness preflight");
  process.exit(analysis);
}

console.log("[wind24-switch] PASS: settlement completeness preflight passed before deep-dive analysis");

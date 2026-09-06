/**
 * run-roi-mechanism-skip-filters-safe.ts — research-only fail-closed runner
 *
 * Require complete official trifecta settlement coverage before the legacy
 * robustness analyzer emits payout-ROI-based candidate verdicts.
 */

import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[roi-mechanism-skip-filter-safe-runner] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-roi-mechanism-skip-filter-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[roi-mechanism-skip-filter-safe-runner] FAIL CLOSED: settlement completeness preflight did not pass; exclusion verdicts were not generated");
  process.exit(preflight);
}

const analysis = run("scripts/analyze-roi-mechanism-skip-filters-raw.ts");
if (analysis !== 0) {
  console.error("[roi-mechanism-skip-filter-safe-runner] skip-filter analysis failed after a successful payout completeness preflight");
  process.exit(analysis);
}

console.log("[roi-mechanism-skip-filter-safe-runner] PASS: payout completeness preflight passed before skip-filter analysis");

/**
 * analyze-roi-skip-interactions.ts — research-only fail-closed entrypoint
 *
 * Missing official trifecta settlement coverage must not become a synthetic
 * zero-return observation in skip/intersection residual analysis.
 */

import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[skip-interactions] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-roi-skip-interactions-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[skip-interactions] FAIL CLOSED: official trifecta settlement coverage is incomplete; skip/intersection verdicts were not generated");
  process.exit(preflight);
}

const analysis = run("scripts/analyze-roi-skip-interactions-core.ts");
if (analysis !== 0) {
  console.error("[skip-interactions] analysis failed after a successful settlement completeness preflight");
  process.exit(analysis);
}

console.log("[skip-interactions] PASS: settlement completeness preflight passed before interaction analysis");

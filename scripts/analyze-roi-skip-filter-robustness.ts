/**
 * Fail-closed ROI skip-filter robustness entrypoint.
 * Research-only: require complete official trifecta settlement coverage before
 * the raw robustness analyzer can emit payout-ROI-based final verdicts.
 */
import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`[skip-filter-robustness] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-roi-skip-filter-robustness-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[skip-filter-robustness] FAIL CLOSED: settlement completeness preflight did not pass; robustness verdicts were not generated");
  process.exit(preflight);
}

const analysis = run("scripts/analyze-roi-skip-filter-robustness-raw.ts");
if (analysis !== 0) {
  console.error("[skip-filter-robustness] raw analysis failed after a successful payout completeness preflight");
  process.exit(analysis);
}

console.log("[skip-filter-robustness] PASS: payout completeness preflight passed before raw analysis");

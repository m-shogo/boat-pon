/**
 * Fail-closed ROI mechanism skip-filter entrypoint.
 * Research-only: require complete official trifecta settlement coverage before
 * the internal exclusion-effect analyzer can emit payout-ROI-based verdicts.
 */
import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`[roi-mechanism-skip-filter] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-roi-mechanism-skip-filter-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[roi-mechanism-skip-filter] FAIL CLOSED: settlement completeness preflight did not pass; exclusion verdicts were not generated");
  process.exit(preflight);
}

await import("./analyze-roi-mechanism-skip-filters-raw");
console.log("[roi-mechanism-skip-filter] PASS: payout completeness preflight passed before internal analysis");

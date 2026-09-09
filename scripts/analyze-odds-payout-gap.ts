/**
 * odds-payout-gap fail-closed entrypoint implementation.
 * Runs official trifecta settlement completeness validation before the legacy
 * odds-vs-payout analysis. No DB writes, app_settings changes, production
 * decisions, notifications, or betting.
 */

import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[odds-payout-gap-safe-runner] failed to start ${script}: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

const preflight = run("scripts/audit-odds-payout-gap-completeness.ts");
if (preflight !== 0) {
  console.error("[odds-payout-gap-safe-runner] FAIL CLOSED: payout completeness preflight did not pass; payout ROI/verdict analysis was not generated");
  process.exit(preflight);
}

await import("./analyze-odds-payout-gap-raw");

console.log("[odds-payout-gap-safe-runner] PASS: completeness preflight passed before odds-payout-gap analysis");

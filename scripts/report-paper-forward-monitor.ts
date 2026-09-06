/**
 * report-paper-forward-monitor.ts — research-only fail-closed entrypoint
 *
 * Require complete official trifecta settlement coverage before the historical
 * paper-forward monitor emits payout ROI, switch/exclusion trends, or upgrade verdicts.
 */

import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`[paper-forward-monitor-entrypoint] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-paper-forward-monitor-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[paper-forward-monitor-entrypoint] FAIL CLOSED: official trifecta settlement coverage is incomplete; monitor ROI/trend/verdict output was not generated");
  process.exit(preflight);
}

const report = run("scripts/report-paper-forward-monitor-raw.ts");
if (report !== 0) {
  console.error("[paper-forward-monitor-entrypoint] report failed after a successful payout completeness preflight");
  process.exit(report);
}

console.log("[paper-forward-monitor-entrypoint] PASS: payout completeness preflight passed before monitor report generation");

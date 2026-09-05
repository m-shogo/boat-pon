/**
 * run-paper-forward-monitor-safe.ts — research-only fail-closed runner
 *
 * Runs the official trifecta settlement completeness preflight first and invokes
 * the legacy paper-forward monitor only when the preflight succeeds.
 * No DB writes, app_settings changes, production decisions, notifications, or betting.
 */

import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[paper-forward-safe-runner] failed to start ${script}: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

const preflight = run("scripts/audit-paper-forward-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[paper-forward-safe-runner] FAIL CLOSED: payout completeness preflight did not pass; monitor ROI/verdict output was not generated");
  process.exit(preflight);
}

const monitor = run("scripts/report-paper-forward-monitor.ts");
if (monitor !== 0) {
  console.error("[paper-forward-safe-runner] paper-forward monitor failed after a successful payout completeness preflight");
  process.exit(monitor);
}

console.log("[paper-forward-safe-runner] PASS: completeness preflight passed before paper-forward monitor execution");

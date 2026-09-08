/**
 * report-paper-forward-candidates-core.ts — research-only fail-closed core launcher
 *
 * This path must be safe even when invoked directly. It runs the canonical
 * official-settlement preflight before delegating to the read-only aggregation
 * implementation. No DB writes, app_settings changes, notifications, production
 * decisions, or betting are performed here.
 */

import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[paper-forward-core] failed to start ${script}: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

const preflight = run("scripts/audit-odds-payout-gap-completeness.ts");
if (preflight !== 0) {
  console.error("[paper-forward-core] FAIL CLOSED: official trifecta settlement completeness did not pass; internal candidate aggregation was not started");
  process.exit(preflight);
}

const internal = run("scripts/report-paper-forward-candidates-internal.ts");
if (internal !== 0) {
  console.error("[paper-forward-core] internal candidate aggregation failed after a successful settlement completeness preflight");
  process.exit(internal);
}

console.log("[paper-forward-core] PASS: settlement completeness preflight passed before internal candidate aggregation");

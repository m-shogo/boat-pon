/**
 * report-paper-forward-candidates.ts — research-only fail-closed entrypoint
 *
 * The candidate ledger interprets absent trifecta combinations as zero return only
 * after proving every race in the exact historical research population has an
 * official trifecta settlement. No DB writes, app_settings changes, production
 * decisions, notifications, or betting are performed here.
 */

import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[paper-forward-candidates] failed to start ${script}: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

const preflight = run("scripts/audit-odds-payout-gap-completeness.ts");
if (preflight !== 0) {
  console.error("[paper-forward-candidates] FAIL CLOSED: official trifecta settlement completeness did not pass; candidate ledger was not generated");
  process.exit(preflight);
}

const report = run("scripts/report-paper-forward-candidates-core.ts");
if (report !== 0) {
  console.error("[paper-forward-candidates] candidate ledger failed after a successful settlement completeness preflight");
  process.exit(report);
}

console.log("[paper-forward-candidates] PASS: settlement completeness preflight passed before candidate ledger generation");

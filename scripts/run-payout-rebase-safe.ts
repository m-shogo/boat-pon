/**
 * run-payout-rebase-safe.ts — research-only fail-closed runner
 *
 * analyze-payout-rebase.ts uses the same historical research population as the
 * odds-vs-payout gap analysis. Require complete official trifecta settlement
 * coverage before generating payout-based switch/exclusion classifications.
 * No DB writes, app_settings changes, production decisions, notifications, or betting.
 */

import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[payout-rebase-safe-runner] failed to start ${script}: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

const preflight = run("scripts/audit-odds-payout-gap-completeness.ts");
if (preflight !== 0) {
  console.error("[payout-rebase-safe-runner] FAIL CLOSED: settlement completeness preflight did not pass; payout-based classifications were not generated");
  process.exit(preflight);
}

const analysis = run("scripts/analyze-payout-rebase.ts");
if (analysis !== 0) {
  console.error("[payout-rebase-safe-runner] payout rebase analysis failed after a successful settlement completeness preflight");
  process.exit(analysis);
}

console.log("[payout-rebase-safe-runner] PASS: completeness preflight passed before payout rebase analysis");

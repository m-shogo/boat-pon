/**
 * analyze-ticket-selector-strategies.ts — research-only fail-closed entrypoint
 *
 * The selector ranks multiple bet types by payout ROI. Direct invocation must
 * first prove that every compared payout market is complete for the exact base
 * research population so missing settlements cannot become zero-return races.
 */

import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[ticket-selector] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-ticket-selector-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[ticket-selector] FAIL CLOSED: compared-market payout coverage is incomplete; ROI/best-strategy analysis was not generated");
  process.exit(preflight);
}

const analysis = run("scripts/analyze-ticket-selector-strategies-core.ts");
if (analysis !== 0) {
  console.error("[ticket-selector] analysis failed after successful payout completeness preflight");
  process.exit(analysis);
}

console.log("[ticket-selector] PASS: payout completeness preflight passed before selector analysis");

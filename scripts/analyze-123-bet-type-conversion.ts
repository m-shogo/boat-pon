/**
 * analyze-123-bet-type-conversion.ts — research-only fail-closed entrypoint
 *
 * The underlying analysis compares multiple payout bet types. Missing settlement
 * coverage must not be interpreted as a zero return and must not influence
 * best-bet, switch, or exclusion verdicts.
 */

import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[123-bet-type-conversion] failed to start ${script}: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

const preflight = run("scripts/audit-123-bet-type-conversion-completeness.ts");
if (preflight !== 0) {
  console.error("[123-bet-type-conversion] FAIL CLOSED: required official settlement coverage is incomplete; cross-bet ROI/verdict analysis was not generated");
  process.exit(preflight);
}

const analysis = run("scripts/analyze-123-bet-type-conversion-core.ts");
if (analysis !== 0) {
  console.error("[123-bet-type-conversion] analysis failed after a successful settlement completeness preflight");
  process.exit(analysis);
}

console.log("[123-bet-type-conversion] PASS: all required official settlement types were complete before analysis");

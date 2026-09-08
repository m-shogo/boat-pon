/**
 * check-alternative-odds-timeseries-health.ts — research-only fail-closed entrypoint
 *
 * Alternative-odds timeseries coverage/readiness metrics may be generated only
 * after the historical BUY overlap population is verified as canonical settled
 * trifecta data. This launcher itself emits no private odds/readiness counts.
 */

import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`[alternative-odds-health] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-alternative-odds-timeseries-health-cohort.ts");
if (preflight !== 0) {
  console.error("[alternative-odds-health] FAIL CLOSED: canonical forward cohort preflight did not pass; coverage/readiness output was not generated");
  process.exit(preflight);
}

const health = run("scripts/check-alternative-odds-timeseries-health-internal.ts");
if (health !== 0) {
  console.error("[alternative-odds-health] internal read-only health report failed after a successful cohort preflight");
  process.exit(health);
}

console.log("[alternative-odds-health] PASS: cohort preflight passed before health report generation");

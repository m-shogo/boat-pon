/**
 * report-exacta-forward-monitor.ts — guarded research-only entrypoint
 *
 * The internal monitor consumes historical_alternative_odds; it intentionally
 * does not consume odds_timeseries_snapshots. Before any forward ROI/readiness
 * report is generated, validate the locked decision cohort and official exacta
 * settlement return states. No production behavior is changed.
 */
import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`[exacta-forward-monitor] failed to start guarded research step: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-exacta-forward-monitor-settlements.ts");
if (preflight !== 0) {
  console.error("[exacta-forward-monitor] FAIL CLOSED: cohort/settlement preflight did not pass; forward metrics were not generated");
  process.exit(preflight);
}

const monitor = run("scripts/report-exacta-forward-monitor-internal.ts");
if (monitor !== 0) process.exit(monitor);

/**
 * report-paper-forward-monitor-raw.ts — guarded research-only compatibility entrypoint
 *
 * Historical paper-forward monitor ROI/trend/verdict output must not be reachable
 * without the canonical official trifecta settlement preflight. This compatibility
 * path contains no DB aggregation logic itself.
 */

import { spawnSync } from "node:child_process";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

function run(script: string, env: NodeJS.ProcessEnv = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    console.error(`[paper-forward-monitor-raw] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-paper-forward-monitor-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[paper-forward-monitor-raw] FAIL CLOSED: official trifecta settlement coverage/integrity did not pass; internal monitor aggregation was not started");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "PAPER_FORWARD_MONITOR_RAW_DB_HANDOFF_IDENTITY_INVALID",
);

const report = run("scripts/report-paper-forward-monitor-internal.ts", {
  ...process.env,
  BOAT_PON_DB_PATH: handoffDbPath,
});
if (report !== 0) {
  console.error("[paper-forward-monitor-raw] internal monitor aggregation failed after a successful settlement preflight");
  process.exit(report);
}

console.log("[paper-forward-monitor-raw] PASS: settlement preflight passed before internal monitor aggregation");
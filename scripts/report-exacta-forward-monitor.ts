/**
 * report-exacta-forward-monitor.ts — guarded research-only entrypoint
 *
 * The internal monitor consumes historical_alternative_odds; it intentionally
 * does not consume odds_timeseries_snapshots. Before any forward ROI/readiness
 * report is generated, validate the locked decision cohort and official exacta
 * settlement return states. No production behavior is changed.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const CANDIDATES_PATH = "data/exacta-forward-candidates.json";

function run(script: string, env = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
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

if (!existsSync(DB_PATH)) throw new Error("EXACTA_FORWARD_MONITOR_DB_MISSING");
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "EXACTA_FORWARD_MONITOR_DB_HANDOFF_IDENTITY_INVALID",
);
if (!existsSync(CANDIDATES_PATH)) throw new Error("EXACTA_FORWARD_MONITOR_CANDIDATES_MISSING");
assertCanonicalSingleLinkRegularFile(
  CANDIDATES_PATH,
  "EXACTA_FORWARD_MONITOR_CANDIDATE_IDENTITY_INVALID",
);
const childDbPath = assertCanonicalSingleLinkRegularFile(
  handoffDbPath,
  "EXACTA_FORWARD_MONITOR_DB_CHILD_HANDOFF_IDENTITY_INVALID",
);
process.env.BOAT_PON_DB_PATH = childDbPath;
await import("./report-exacta-forward-monitor-internal");

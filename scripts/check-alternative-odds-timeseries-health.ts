/**
 * check-alternative-odds-timeseries-health.ts — research-only fail-closed entrypoint
 *
 * Alternative-odds timeseries coverage/readiness metrics may be generated only
 * after the historical BUY overlap population is verified as canonical settled
 * trifecta data. This launcher itself emits no private odds/readiness counts.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";

function run(script: string, env = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
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

if (!existsSync(DB_PATH)) throw new Error("ALTERNATIVE_ODDS_HEALTH_DB_MISSING");
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "ALTERNATIVE_ODDS_HEALTH_DB_HANDOFF_IDENTITY_INVALID",
);

const health = run("scripts/check-alternative-odds-timeseries-health-internal.ts", {
  ...process.env,
  BOAT_PON_DB_PATH: handoffDbPath,
});
if (health !== 0) {
  console.error("[alternative-odds-health] internal read-only health report failed after a successful cohort preflight");
  process.exit(health);
}

console.log("[alternative-odds-health] PASS: cohort preflight passed before health report generation");

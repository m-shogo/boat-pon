/**
 * report-research-governor.ts — guarded research-only entrypoint
 *
 * Readiness counts may drive the next research action, so they must not be
 * generated from a drifted BUY cohort or from non-canonical/incomplete
 * historical trifecta markets. The preflight is read-only and fail-closed.
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
    console.error(`[research-governor] failed to start guarded research step: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-research-governor-readiness.ts");
if (preflight !== 0) {
  console.error("[research-governor] FAIL CLOSED: readiness preflight did not pass; no next-action/readiness report was generated");
  process.exit(preflight);
}

if (!existsSync(DB_PATH)) throw new Error("RESEARCH_GOVERNOR_DB_MISSING");
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "RESEARCH_GOVERNOR_DB_HANDOFF_IDENTITY_INVALID",
);
const report = run("scripts/report-research-governor-raw.ts", {
  ...process.env,
  BOAT_PON_DB_PATH: handoffDbPath,
});
if (report !== 0) process.exit(report);
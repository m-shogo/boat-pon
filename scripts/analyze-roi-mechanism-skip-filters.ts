/**
 * Fail-closed ROI mechanism skip-filter entrypoint.
 * Research-only: require complete official trifecta settlement coverage before
 * the internal exclusion-effect analyzer can emit payout-ROI-based verdicts.
 */
import { spawnSync } from "node:child_process";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`[roi-mechanism-skip-filter] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-roi-mechanism-skip-filter-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[roi-mechanism-skip-filter] FAIL CLOSED: settlement completeness preflight did not pass; exclusion verdicts were not generated");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ROI_MECHANISM_SKIP_FILTER_DB_HANDOFF_IDENTITY_INVALID",
);
process.env.BOAT_PON_DB_PATH = handoffDbPath;

await import("./analyze-roi-mechanism-skip-filters-raw");
console.log("[roi-mechanism-skip-filter] PASS: payout completeness preflight passed before internal analysis");
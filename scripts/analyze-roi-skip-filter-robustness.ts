/**
 * Fail-closed ROI skip-filter robustness entrypoint.
 * Research-only: require complete official trifecta settlement coverage before
 * the internal robustness analyzer can emit payout-ROI-based final verdicts.
 */
import { spawnSync } from "node:child_process";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`[skip-filter-robustness] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-roi-skip-filter-robustness-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[skip-filter-robustness] FAIL CLOSED: settlement completeness preflight did not pass; robustness verdicts were not generated");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ROI_SKIP_FILTER_ROBUSTNESS_DB_HANDOFF_IDENTITY_INVALID",
);
process.env.BOAT_PON_DB_PATH = handoffDbPath;

await import("./analyze-roi-skip-filter-robustness-raw");
console.log("[skip-filter-robustness] PASS: payout completeness preflight passed before internal analysis");
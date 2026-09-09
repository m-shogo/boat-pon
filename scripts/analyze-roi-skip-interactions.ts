/**
 * analyze-roi-skip-interactions.ts — research-only fail-closed entrypoint
 *
 * Missing official trifecta settlement coverage must not become a synthetic
 * zero-return observation in skip/intersection residual analysis.
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";

function run(script: string, env = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
  });

  if (result.error) {
    console.error(`[skip-interactions] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-roi-skip-interactions-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[skip-interactions] FAIL CLOSED: official trifecta settlement coverage is incomplete; skip/intersection verdicts were not generated");
  process.exit(preflight);
}

if (!existsSync(DB_PATH)) {
  throw new Error("ROI_SKIP_INTERACTIONS_PRIMARY_DB_MISSING");
}
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "ROI_SKIP_INTERACTIONS_PRIMARY_DB_IDENTITY_INVALID",
);

const analysis = run("scripts/analyze-roi-skip-interactions-core.ts", {
  ...process.env,
  BOAT_PON_DB_PATH: verifiedDbPath,
});
if (analysis !== 0) {
  console.error("[skip-interactions] analysis failed after a successful settlement completeness preflight");
  process.exit(analysis);
}

console.log("[skip-interactions] PASS: settlement completeness preflight and DB identity verification passed before interaction analysis");

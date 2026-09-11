/**
 * analyze-roi-edge-market-gap.ts — research-only fail-closed entrypoint
 *
 * Require complete official trifecta settlement coverage before the legacy
 * market-gap analyzer emits 1-2-3 ROI, 1-3-2 missed-opportunity ROI, or verdicts.
 */

import { spawnSync } from "node:child_process";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[roi-edge-market-gap-entrypoint] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-roi-edge-market-gap-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[roi-edge-market-gap-entrypoint] FAIL CLOSED: official trifecta settlement coverage is incomplete; market-gap ROI/verdicts were not generated");
  process.exit(preflight);
}

await import("./assert-roi-edge-market-gap-db-boundary");
const childDbPath = assertCanonicalSingleLinkRegularFile(
  process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite",
  "ROI_EDGE_MARKET_GAP_DB_CHILD_HANDOFF_IDENTITY_INVALID",
);
process.env.BOAT_PON_DB_PATH = childDbPath;
await import("./analyze-roi-edge-market-gap-internal");

console.log("[roi-edge-market-gap-entrypoint] PASS: payout completeness preflight passed before market-gap analysis");

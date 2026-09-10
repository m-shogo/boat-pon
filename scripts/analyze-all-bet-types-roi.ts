import { spawnSync } from "node:child_process";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const audit = run("scripts/audit-all-bet-types-payout-completeness.ts");
if (audit !== 0) {
  console.error("[all-bet-types-roi] FAIL CLOSED: official payout settlement coverage is incomplete; ROI analysis was not generated");
  process.exit(audit);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ALL_BET_TYPES_ROI_DB_HANDOFF_IDENTITY_INVALID",
);
process.env.BOAT_PON_DB_PATH = handoffDbPath;

await import("./analyze-all-bet-types-roi-raw");

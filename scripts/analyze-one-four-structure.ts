import { existsSync } from "node:fs";
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
  console.error("[one-four-structure] FAIL CLOSED: official payout settlement coverage is incomplete; structure analysis was not generated");
  process.exit(audit);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(configuredDbPath)) {
  throw new Error("ONE_FOUR_STRUCTURE_DB_MISSING");
}
process.env.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ONE_FOUR_STRUCTURE_DB_HANDOFF_IDENTITY_INVALID",
);

await import("./analyze-one-four-structure-internal");

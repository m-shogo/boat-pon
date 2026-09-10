import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";

if (!existsSync(DB_PATH)) {
  throw new Error("SKIP6R_SWITCH_HISTORICAL_PRIMARY_DB_MISSING");
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "SKIP6R_SWITCH_HISTORICAL_PRIMARY_DB_IDENTITY_INVALID",
);
const childEnv = { ...process.env, BOAT_PON_DB_PATH: verifiedDbPath };

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: childEnv,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const audit = run("scripts/audit-skip6r-historical-payout-completeness.ts");
if (audit !== 0) {
  console.error("[skip6r-switch-historical] FAIL CLOSED: official trifecta settlement coverage is incomplete; switch analysis was not generated");
  process.exit(audit);
}

const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  verifiedDbPath,
  "SKIP6R_SWITCH_HISTORICAL_DB_HANDOFF_IDENTITY_INVALID",
);
process.env.BOAT_PON_DB_PATH = handoffDbPath;
await import("./analyze-skip6r-switch-historical-closing-odds-raw");

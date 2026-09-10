import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const runner = process.platform === "win32" ? "npx.cmd" : "npx";

if (!existsSync(DB_PATH)) {
  throw new Error("EXACTA_MARKET_RESIDUAL_DB_MISSING");
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "EXACTA_MARKET_RESIDUAL_PRIMARY_DB_IDENTITY_INVALID",
);

const audit = spawnSync(runner, ["tsx", "scripts/audit-exacta-market-residual-payout-completeness.ts"], {
  stdio: "inherit",
  env: { ...process.env, BOAT_PON_DB_PATH: verifiedDbPath },
});
if (audit.error) throw audit.error;
if (audit.status !== 0) process.exit(audit.status ?? 2);

const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  verifiedDbPath,
  "EXACTA_MARKET_RESIDUAL_DB_HANDOFF_IDENTITY_INVALID",
);
const analysis = spawnSync(runner, ["tsx", "scripts/analyze-exacta-market-residual-sweep-raw.ts"], {
  stdio: "inherit",
  env: { ...process.env, BOAT_PON_DB_PATH: handoffDbPath },
});
if (analysis.error) throw analysis.error;
process.exit(analysis.status ?? 1);
import { spawnSync } from "node:child_process";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID");
const childEnv = { ...process.env, BOAT_PON_DB_PATH: verifiedDbPath };
const forwardedArgs = process.argv.slice(2);

const audit = spawnSync(process.execPath, ["--import", "tsx", "scripts/audit-review-summary-payout-integrity.ts", ...forwardedArgs], {
  stdio: "inherit",
  env: childEnv,
});
if (audit.error) throw audit.error;
if (audit.status !== 0) process.exit(audit.status ?? 1);

const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/report-review-summary-raw.ts", ...forwardedArgs], {
  stdio: "inherit",
  env: childEnv,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

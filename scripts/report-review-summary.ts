import { spawnSync } from "node:child_process";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID");

const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/report-review-summary-raw.ts", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, BOAT_PON_DB_PATH: verifiedDbPath },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

/**
 * Guarded compatibility module for miss-to-bet-type recovery research.
 * The canonical entrypoint validates the historical BUY cohort and official
 * payout settlement integrity before importing this module.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("MISS_RECOVERY_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(configuredDbPath)) {
  throw new Error("MISS_RECOVERY_DB_MISSING");
}
process.env.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "MISS_RECOVERY_DB_IDENTITY_INVALID",
);

await import("./analyze-miss-to-bet-type-recovery-internal");

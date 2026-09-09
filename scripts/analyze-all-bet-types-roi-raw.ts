/**
 * Guarded compatibility module for all-bet-types ROI research.
 * The canonical entrypoint must complete its fail-closed payout-completeness
 * preflight before this module is imported. Direct CLI execution is forbidden.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("ALL_BET_TYPES_ROI_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

const dbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(dbPath)) {
  throw new Error("ALL_BET_TYPES_ROI_DB_MISSING");
}
process.env.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile(
  dbPath,
  "ALL_BET_TYPES_ROI_DB_IDENTITY_INVALID",
);

await import("./analyze-all-bet-types-roi-internal");

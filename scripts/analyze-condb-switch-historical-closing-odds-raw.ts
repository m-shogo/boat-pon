/**
 * Guarded compatibility module for condB historical closing-odds research.
 * The canonical entrypoint validates official trifecta settlement coverage before
 * the internal analyzer may run. Direct CLI execution is forbidden.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("CONDB_SWITCH_HISTORICAL_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

const dbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(dbPath)) {
  throw new Error("CONDB_SWITCH_HISTORICAL_DB_MISSING");
}
process.env.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile(
  dbPath,
  "CONDB_SWITCH_HISTORICAL_DB_IDENTITY_INVALID",
);

await import("./analyze-condb-switch-historical-closing-odds-internal");

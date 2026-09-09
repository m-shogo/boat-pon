/**
 * Guarded compatibility module for condB historical closing-odds research.
 * The canonical entrypoint validates official trifecta settlement coverage before
 * the internal analyzer may run. Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("CONDB_SWITCH_HISTORICAL_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./analyze-condb-switch-historical-closing-odds-internal");

/**
 * Guarded compatibility module for skip6R historical closing-odds research.
 * The canonical entrypoint validates official trifecta settlement coverage before
 * the internal analyzer may run. Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("SKIP6R_SWITCH_HISTORICAL_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./analyze-skip6r-switch-historical-closing-odds-internal");

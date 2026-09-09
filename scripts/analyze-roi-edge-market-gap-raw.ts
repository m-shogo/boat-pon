/**
 * Guarded compatibility module for ROI edge market-gap research.
 * The canonical entrypoint validates official trifecta settlement coverage before
 * the internal analyzer may run. Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("ROI_EDGE_MARKET_GAP_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./analyze-roi-edge-market-gap-internal");

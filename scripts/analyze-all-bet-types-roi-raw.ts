/**
 * Guarded compatibility module for all-bet-types ROI research.
 * The canonical entrypoint must complete its fail-closed payout-completeness
 * preflight before this module is imported. Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("ALL_BET_TYPES_ROI_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./analyze-all-bet-types-roi-internal");

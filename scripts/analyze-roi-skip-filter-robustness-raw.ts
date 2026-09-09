/**
 * Guarded compatibility module for ROI skip-filter robustness research.
 * The canonical entrypoint must complete its fail-closed settlement preflight
 * before the internal analyzer may run. Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("ROI_SKIP_FILTER_ROBUSTNESS_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./analyze-roi-skip-filter-robustness-internal");

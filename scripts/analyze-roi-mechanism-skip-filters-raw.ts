/**
 * Guarded compatibility module for ROI mechanism skip-filter research.
 * The canonical entrypoint must complete its fail-closed settlement preflight
 * before the internal analyzer may run. Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("ROI_MECHANISM_SKIP_FILTER_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./analyze-roi-mechanism-skip-filters-internal");

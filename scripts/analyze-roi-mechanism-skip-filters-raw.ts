/**
 * Guarded compatibility module for ROI mechanism skip-filter research.
 * Imported compatibility callers are routed back through the canonical fail-closed
 * settlement preflight and DB-provenance redaction path. Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("ROI_MECHANISM_SKIP_FILTER_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./analyze-roi-mechanism-skip-filters");

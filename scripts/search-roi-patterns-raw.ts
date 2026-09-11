/**
 * Guarded compatibility module for ROI pattern research.
 * Imported compatibility callers are routed back through the canonical
 * settlement preflight. Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("ROI_PATTERN_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./search-roi-patterns");

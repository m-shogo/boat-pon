/**
 * Guarded compatibility module for ROI skip/interactions research.
 * Imported compatibility callers are routed back through the canonical official
 * trifecta settlement-completeness preflight. Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("ROI_SKIP_INTERACTIONS_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./analyze-roi-skip-interactions");

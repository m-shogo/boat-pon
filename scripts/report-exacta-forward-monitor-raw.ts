/**
 * Guarded compatibility module for exacta forward monitor research.
 * Imported compatibility callers are routed through the canonical cohort and
 * settlement preflight before the internal monitor may run.
 * Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("EXACTA_FORWARD_MONITOR_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./report-exacta-forward-monitor");

/**
 * Guarded compatibility module for H011 forward monitor research.
 * Imported compatibility callers are routed back through the canonical exacta
 * settlement-integrity preflight. Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("H011_FORWARD_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./report-h011-forward-monitor");

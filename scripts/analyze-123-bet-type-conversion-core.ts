/**
 * Guarded compatibility module for 1-2-3 cross-bet conversion research.
 * Imported compatibility callers are routed through the canonical official
 * settlement-completeness preflight. Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const coreEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === coreEntrypointPath) {
  throw new Error("BET_TYPE_CONVERSION_CORE_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./analyze-123-bet-type-conversion");
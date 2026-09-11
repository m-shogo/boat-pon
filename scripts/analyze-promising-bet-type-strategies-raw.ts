/**
 * Guarded compatibility module for promising bet-type strategy research.
 * Imported compatibility callers are routed back through the canonical BUY and
 * payout settlement preflight. Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("PROMISING_BET_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./analyze-promising-bet-type-strategies");
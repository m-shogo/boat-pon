/**
 * Guarded compatibility module for miss-to-bet-type recovery research.
 * Imported compatibility callers are routed back through the canonical historical
 * BUY cohort and official payout settlement preflight. Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("MISS_RECOVERY_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./analyze-miss-to-bet-type-recovery");

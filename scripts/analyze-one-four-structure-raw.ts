/**
 * Guarded compatibility module for one-four structure research.
 * Imported compatibility callers are routed back through the canonical payout
 * completeness audit. Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("ONE_FOUR_STRUCTURE_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./analyze-one-four-structure");

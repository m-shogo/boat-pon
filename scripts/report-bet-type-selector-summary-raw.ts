/**
 * Guarded compatibility module for bet-type selector summary research.
 * The canonical entrypoint validates all prerequisite report envelopes before
 * the internal summary implementation may run. Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("BET_TYPE_SELECTOR_SUMMARY_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./report-bet-type-selector-summary");

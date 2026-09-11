/**
 * Guarded compatibility boundary for the wind24 × exhibition-rank deep dive.
 * Imported compatibility callers are routed through the canonical settlement
 * preflight. Direct CLI execution is forbidden.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const coreEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === coreEntrypointPath) {
  throw new Error("WIND24_SWITCH_CORE_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./analyze-wind24-exh1-switch-deep-dive");
/**
 * Guarded compatibility module for bet-type course-edge research.
 * The canonical entrypoint validates BUY and payout settlement integrity before
 * the internal analyzer may run. Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("BET_TYPE_COURSE_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./analyze-bet-type-course-edge-internal");

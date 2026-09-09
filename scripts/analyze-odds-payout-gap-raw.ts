/**
 * Guarded compatibility module for odds-payout-gap research.
 * The canonical entrypoint must complete its fail-closed settlement preflight
 * before the internal analyzer may run. Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("ODDS_PAYOUT_GAP_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./analyze-odds-payout-gap-internal");

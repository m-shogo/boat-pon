/**
 * Guarded compatibility module for research governor reporting.
 * Imported compatibility callers are routed through the canonical readiness
 * preflight before the internal report implementation may run.
 * Direct CLI execution is forbidden.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("RESEARCH_GOVERNOR_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

await import("./report-research-governor");

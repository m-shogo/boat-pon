/**
 * Guarded compatibility module for H011 forward monitor research.
 * The canonical entrypoint validates settlement integrity first; this module
 * narrows the handoff window by revalidating the research DB identity
 * immediately before the legacy internal monitor is imported.
 * Direct CLI execution is forbidden.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("H011_FORWARD_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(configuredDbPath)) throw new Error("H011_FORWARD_RAW_DB_MISSING");

process.env.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "H011_FORWARD_RAW_DB_IDENTITY_INVALID",
);

await import("./report-h011-forward-monitor-internal");

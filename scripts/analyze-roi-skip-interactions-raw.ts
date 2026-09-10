/**
 * Guarded compatibility module for ROI skip/interactions research.
 * The canonical entrypoint validates official settlement completeness first;
 * this module narrows the handoff window by revalidating the research DB
 * identity immediately before the legacy core analyzer is imported.
 * Direct CLI execution is forbidden.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("ROI_SKIP_INTERACTIONS_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(configuredDbPath)) {
  throw new Error("ROI_SKIP_INTERACTIONS_RAW_DB_MISSING");
}

process.env.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ROI_SKIP_INTERACTIONS_RAW_DB_IDENTITY_INVALID",
);

await import("./analyze-roi-skip-interactions-core");

/**
 * Guarded compatibility module for exacta forward monitor research.
 * The canonical entrypoint validates cohort/settlement integrity before this
 * module narrows the handoff window and revalidates DB + frozen candidate file
 * identities immediately before the legacy internal monitor is imported.
 * Direct CLI execution is forbidden.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const rawEntrypointPath = resolve(fileURLToPath(import.meta.url));
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === rawEntrypointPath) {
  throw new Error("EXACTA_FORWARD_MONITOR_RAW_DIRECT_EXECUTION_FORBIDDEN");
}

const dbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const candidatesPath = "data/exacta-forward-candidates.json";
if (!existsSync(dbPath)) throw new Error("EXACTA_FORWARD_MONITOR_RAW_DB_MISSING");
if (!existsSync(candidatesPath)) throw new Error("EXACTA_FORWARD_MONITOR_RAW_CANDIDATES_MISSING");

process.env.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile(
  dbPath,
  "EXACTA_FORWARD_MONITOR_RAW_DB_IDENTITY_INVALID",
);
assertCanonicalSingleLinkRegularFile(
  candidatesPath,
  "EXACTA_FORWARD_MONITOR_RAW_CANDIDATE_IDENTITY_INVALID",
);

await import("./report-exacta-forward-monitor-internal");

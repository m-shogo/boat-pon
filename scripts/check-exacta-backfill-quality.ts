/**
 * Guarded entrypoint for the historical exacta backfill quality audit.
 *
 * Validates canonical research DB identity and the historical BUY target cohort
 * before loading the existing read-only quality implementation in isolation.
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/exacta-backfill-quality.md";
const OUT_JSON = "reports/exacta-backfill-quality.json";
const EXCL_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES = [10, 11, 12];
const internalPath = fileURLToPath(new URL("./check-exacta-backfill-quality-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

function atomicPublish(path: string, content: string, errorCode: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, errorCode);
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

if (!existsSync(DB_PATH)) {
  console.error("[exacta-backfill-quality] research database unavailable");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "EXACTA_BACKFILL_QUALITY_DB_IDENTITY_INVALID",
);
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

const placeholdersV = EXCL_VENUES.map(() => "?").join(",");
const placeholdersR = EXCL_RACES.map(() => "?").join(",");
const invalidTargetCohort = db.prepare(`
  SELECT COUNT(*) AS invalid
  FROM decision_history dh
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result != ''
    AND dh.current_odds IS NOT NULL
    AND dh.selection='1-2-3'
    AND dh.venue NOT IN (${placeholdersV})
    AND dh.race_no NOT IN (${placeholdersR})
    AND dh.date >= '2024-01-01'
    AND (
      dh.bet_type IS NULL OR dh.bet_type != '3連単'
      OR dh.returned IS NULL OR dh.returned != 0
    )
`).get(...EXCL_VENUES, ...EXCL_RACES) as { invalid: number };

if (Number(invalidTargetCohort.invalid ?? 0) > 0) {
  db.close();
  throw new Error("EXACTA_BACKFILL_QUALITY_DECISION_COHORT_INVALID");
}

db.close();
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  verifiedDbPath,
  "EXACTA_BACKFILL_QUALITY_DB_HANDOFF_IDENTITY_INVALID",
);
const childDbPath = assertCanonicalSingleLinkRegularFile(
  handoffDbPath,
  "EXACTA_BACKFILL_QUALITY_DB_CHILD_HANDOFF_IDENTITY_INVALID",
);

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-exacta-backfill-quality-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const loader = `await import(${JSON.stringify(pathToFileURL(internalPath).href)})`;
  const analysis = spawnSync(
    process.execPath,
    ["--import", tsxLoader, "--input-type=module", "--eval", loader],
    {
      cwd: workspace,
      env: { ...process.env, BOAT_PON_DB_PATH: childDbPath },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (analysis.error || analysis.status !== 0) {
    throw new Error("EXACTA_BACKFILL_QUALITY_INTERNAL_FAILED");
  }

  const workspaceMd = join(workspace, OUT_MD);
  const workspaceJson = join(workspace, OUT_JSON);
  if (!existsSync(workspaceMd)) throw new Error("EXACTA_BACKFILL_QUALITY_MD_OUTPUT_MISSING");
  if (!existsSync(workspaceJson)) throw new Error("EXACTA_BACKFILL_QUALITY_JSON_OUTPUT_MISSING");

  const verifiedMdPath = assertCanonicalSingleLinkRegularFile(
    workspaceMd,
    "EXACTA_BACKFILL_QUALITY_MD_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    workspaceJson,
    "EXACTA_BACKFILL_QUALITY_JSON_OUTPUT_IDENTITY_INVALID",
  );
  const markdown = readFileSync(verifiedMdPath, "utf8").split(childDbPath).join("verified read-only research DB");
  const json = readFileSync(verifiedJsonPath, "utf8").split(childDbPath).join("verified read-only research DB");

  mkdirSync("reports", { recursive: true });
  atomicPublish(
    OUT_MD,
    markdown,
    "EXACTA_BACKFILL_QUALITY_MD_PUBLISH_TEMP_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_JSON,
    json,
    "EXACTA_BACKFILL_QUALITY_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

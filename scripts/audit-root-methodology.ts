/**
 * Guarded entrypoint for the root methodology audit.
 *
 * The report intentionally compares several distinct cohorts, but the
 * historical governor-forward cohort must remain the canonical settled
 * trifecta population. Validate that population before loading the existing
 * read-only methodology implementation.
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
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const EXCL_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const OUT_MD = "reports/root-methodology-audit.md";
const OUT_JSON = "reports/root-methodology-audit.json";
const internalPath = fileURLToPath(new URL("./audit-root-methodology-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

function atomicPublish(path: string, contents: string, errorCode: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, contents, "utf8");
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

if (!existsSync(DB_PATH)) throw new Error("ROOT_METHODOLOGY_RESEARCH_DB_UNAVAILABLE");

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "ROOT_METHODOLOGY_PRIMARY_DB_IDENTITY_INVALID",
);
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");

const blankHistoricalResults = db.prepare(`
  SELECT COUNT(*) AS invalid
  FROM decision_history dh
  WHERE dh.decision='BUY'
    AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL
    AND TRIM(dh.result)=''
`).get() as { invalid: number };

if (Number(blankHistoricalResults.invalid ?? 0) > 0) {
  db.close();
  throw new Error("ROOT_METHODOLOGY_BLANK_HISTORICAL_RESULT_UNSUPPORTED");
}

const venuePlaceholders = EXCL_VENUES.map(() => "?").join(",");
const invalidForwardCohort = db.prepare(`
  SELECT COUNT(*) AS invalid
  FROM decision_history dh
  WHERE dh.decision='BUY'
    AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result!=''
    AND dh.current_odds IS NOT NULL
    AND dh.selection='1-2-3'
    AND dh.date >= '2025-01-01'
    AND dh.venue NOT IN (${venuePlaceholders})
    AND dh.race_no NOT IN (10,11,12)
    AND (
      dh.bet_type IS NULL OR dh.bet_type != '3連単'
      OR dh.returned IS NULL OR dh.returned != 0
    )
`).get(...EXCL_VENUES) as { invalid: number };

if (Number(invalidForwardCohort.invalid ?? 0) > 0) {
  db.close();
  throw new Error("ROOT_METHODOLOGY_FORWARD_COHORT_INVALID");
}

db.close();
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  verifiedDbPath,
  "ROOT_METHODOLOGY_DB_HANDOFF_IDENTITY_INVALID",
);

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-root-methodology-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    handoffDbPath,
    "ROOT_METHODOLOGY_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  const audit = spawnSync(process.execPath, ["--import", tsxLoader, internalPath], {
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (audit.error || audit.status !== 0) {
    throw new Error("ROOT_METHODOLOGY_INTERNAL_FAILED");
  }

  const workspaceJson = join(workspace, OUT_JSON);
  const workspaceMarkdown = join(workspace, OUT_MD);
  if (!existsSync(workspaceJson)) throw new Error("ROOT_METHODOLOGY_JSON_OUTPUT_MISSING");
  if (!existsSync(workspaceMarkdown)) throw new Error("ROOT_METHODOLOGY_MARKDOWN_OUTPUT_MISSING");
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    workspaceJson,
    "ROOT_METHODOLOGY_JSON_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedMarkdownPath = assertCanonicalSingleLinkRegularFile(
    workspaceMarkdown,
    "ROOT_METHODOLOGY_MARKDOWN_OUTPUT_IDENTITY_INVALID",
  );
  const json = readFileSync(verifiedJsonPath, "utf8");
  const markdown = readFileSync(verifiedMarkdownPath, "utf8");

  mkdirSync("reports", { recursive: true });
  atomicPublish(
    OUT_JSON,
    json,
    "ROOT_METHODOLOGY_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_MD,
    markdown,
    "ROOT_METHODOLOGY_MARKDOWN_PUBLISH_TEMP_IDENTITY_INVALID",
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("[root-methodology-audit] PASS: canonical cohort preflight and isolated report publication completed");

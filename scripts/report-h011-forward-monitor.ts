/**
 * Fail-closed H011 forward-monitor entrypoint.
 * Research-only: no DB writes, production decisions, notifications, or betting.
 * Pending races may have zero exacta settlement rows; once a settlement exists it
 * must be exactly one positive, non-refund official exacta line before ROI/verdict
 * aggregation is allowed to run.
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
const MONITOR_START = process.env.H011_MONITOR_START ?? "2026-06-01";
const RUN_KIND = process.env.H011_RUN_KIND ?? "paper-live";
const EXCL_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES = [10, 11, 12];
const OUT_MD = "reports/h011-forward-monitor.md";
const OUT_JSON = "reports/h011-forward-monitor.json";

function atomicPublish(
  path: string,
  contents: string,
  tempErrorCode: string,
  destinationErrorCode: string,
): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, contents, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode);
    if (existsSync(path)) {
      assertCanonicalSingleLinkRegularFile(path, destinationErrorCode);
    }
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

if (!existsSync(DB_PATH)) throw new Error("H011_FORWARD_PRIMARY_DB_MISSING");
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "H011_FORWARD_PRIMARY_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000;");

type IntegrityRow = {
  population: number;
  pending: number;
  settled: number;
  ambiguous: number;
};

try {
  const placeholdersV = EXCL_VENUES.map(() => "?").join(",");
  const placeholdersR = EXCL_RACES.map(() => "?").join(",");
  const row = db.prepare(`
    WITH population AS (
      SELECT DISTINCT dh.race_id
      FROM decision_history dh
      WHERE dh.decision='BUY'
        AND dh.run_kind=?
        AND dh.current_odds IS NOT NULL
        AND dh.venue NOT IN (${placeholdersV})
        AND dh.race_no NOT IN (${placeholdersR})
        AND dh.selection='1-2-3'
        AND dh.date>=?
    ), settlement AS (
      SELECT p.race_id,
        COUNT(rp.race_id) AS line_count,
        SUM(CASE WHEN rp.race_id IS NOT NULL
          AND rp.returned=0
          AND rp.combination IS NOT NULL
          AND rp.combination!=''
          AND rp.payout_yen IS NOT NULL
          AND rp.payout_yen>0
        THEN 1 ELSE 0 END) AS valid_count
      FROM population p
      LEFT JOIN race_payouts rp
        ON rp.race_id=p.race_id AND rp.bet_type='exacta'
      GROUP BY p.race_id
    )
    SELECT
      COUNT(*) AS population,
      SUM(CASE WHEN line_count=0 THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN line_count=1 AND valid_count=1 THEN 1 ELSE 0 END) AS settled,
      SUM(CASE WHEN line_count>0 AND NOT (line_count=1 AND valid_count=1) THEN 1 ELSE 0 END) AS ambiguous
    FROM settlement
  `).get(RUN_KIND, ...EXCL_VENUES, ...EXCL_RACES, MONITOR_START) as IntegrityRow;

  const integrity = {
    population: Number(row?.population ?? 0),
    pending: Number(row?.pending ?? 0),
    settled: Number(row?.settled ?? 0),
    ambiguous: Number(row?.ambiguous ?? 0),
  };

  if (!Object.values(integrity).every(Number.isInteger)
    || integrity.population < 0
    || integrity.pending < 0
    || integrity.settled < 0
    || integrity.ambiguous < 0
    || integrity.pending + integrity.settled + integrity.ambiguous !== integrity.population
    || integrity.ambiguous !== 0) {
    throw new Error(`H011_FORWARD_EXACTA_SETTLEMENT_INTEGRITY_FAILED ${JSON.stringify(integrity)}`);
  }

  console.log(`[h011-forward] settlement preflight PASS population=${integrity.population} settled=${integrity.settled} pending=${integrity.pending}`);
} finally {
  db.close();
}

if (!existsSync(DB_PATH)) throw new Error("H011_FORWARD_HANDOFF_DB_MISSING");
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "H011_FORWARD_DB_HANDOFF_IDENTITY_INVALID",
);
const internalPath = fileURLToPath(new URL("./report-h011-forward-monitor-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");
const workspace = mkdtempSync(join(tmpdir(), "boat-pon-h011-forward-"));

try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    handoffDbPath,
    "H011_FORWARD_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  const monitor = spawnSync(process.execPath, ["--import", tsxLoader, internalPath], {
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (monitor.error || monitor.status !== 0) throw new Error("H011_FORWARD_INTERNAL_FAILED");

  const workspaceMarkdown = join(workspace, OUT_MD);
  const workspaceJson = join(workspace, OUT_JSON);
  if (!existsSync(workspaceMarkdown)) throw new Error("H011_FORWARD_MARKDOWN_OUTPUT_MISSING");
  if (!existsSync(workspaceJson)) throw new Error("H011_FORWARD_JSON_OUTPUT_MISSING");
  const verifiedMarkdownPath = assertCanonicalSingleLinkRegularFile(
    workspaceMarkdown,
    "H011_FORWARD_MARKDOWN_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    workspaceJson,
    "H011_FORWARD_JSON_OUTPUT_IDENTITY_INVALID",
  );
  const markdown = readFileSync(verifiedMarkdownPath, "utf8");
  const json = readFileSync(verifiedJsonPath, "utf8");

  mkdirSync("reports", { recursive: true });
  atomicPublish(
    OUT_MD,
    markdown,
    "H011_FORWARD_MARKDOWN_PUBLISH_TEMP_IDENTITY_INVALID",
    "H011_FORWARD_MARKDOWN_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_JSON,
    json,
    "H011_FORWARD_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
    "H011_FORWARD_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("[h011-forward] PASS: settlement preflight and isolated report publication completed");

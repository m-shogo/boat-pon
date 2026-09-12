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
const DECISION_BET_TYPE = "3連単";
const PAYOUT_BET_TYPE = "trifecta";
const OUT_MD = "reports/roi-hypothesis-sets.md";
const OUT_JSON = "reports/roi-hypothesis-sets.json";

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

if (!existsSync(DB_PATH)) {
  console.error("[analyze-roi-hypothesis-sets] database not found");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "roi-hypothesis-sets primary database identity mismatch");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

try {
  const invalidReturn = db.prepare(`
SELECT COUNT(*) AS n
FROM decision_history dh
WHERE dh.run_kind = 'historical-backfill'
  AND dh.decision = 'BUY'
  AND dh.bet_type = ?
  AND dh.current_odds IS NOT NULL
  AND dh.result IS NOT NULL
  AND dh.result != ''
  AND (dh.returned IS NULL OR dh.returned != 0)
`).get(DECISION_BET_TYPE) as { n: number };

  if ((invalidReturn.n ?? 0) > 0) {
    console.error(`[analyze-roi-hypothesis-sets] FAIL CLOSED: ${invalidReturn.n} historical BUY row(s) have unknown or returned settlement state`);
    process.exit(2);
  }

  const integrity = db.prepare(`
WITH relevant_settled AS (
  SELECT DISTINCT dh.race_id, dh.result
  FROM decision_history dh
  WHERE dh.run_kind = 'historical-backfill'
    AND dh.decision = 'BUY'
    AND dh.bet_type = ?
    AND dh.current_odds IS NOT NULL
    AND dh.result IS NOT NULL
    AND dh.result != ''
    AND dh.returned = 0
), invalid AS (
  SELECT s.race_id, s.result
  FROM relevant_settled s
  WHERE (
    SELECT COUNT(*)
    FROM race_payouts rp
    WHERE rp.race_id = s.race_id
      AND rp.bet_type = ?
      AND rp.combination = s.result
  ) != 1
  OR (
    SELECT COUNT(*)
    FROM race_payouts rp
    WHERE rp.race_id = s.race_id
      AND rp.bet_type = ?
      AND rp.combination = s.result
      AND rp.returned = 0
      AND rp.payout_yen IS NOT NULL
      AND rp.payout_yen > 0
  ) != 1
)
SELECT COUNT(*) AS n FROM invalid
`).get(DECISION_BET_TYPE, PAYOUT_BET_TYPE, PAYOUT_BET_TYPE) as { n: number };

  if ((integrity.n ?? 0) > 0) {
    console.error(`[analyze-roi-hypothesis-sets] FAIL CLOSED: ${integrity.n} settled denominator race(s) do not have exactly one positive non-refund official winning settlement`);
    process.exit(2);
  }
} finally {
  db.close();
}

const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  verifiedDbPath,
  "ROI_HYPOTHESIS_DB_HANDOFF_IDENTITY_INVALID",
);
const internalPath = fileURLToPath(new URL("./analyze-roi-hypothesis-sets-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");
const workspace = mkdtempSync(join(tmpdir(), "boat-pon-roi-hypothesis-"));

try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    handoffDbPath,
    "ROI_HYPOTHESIS_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  const analysis = spawnSync(process.execPath, ["--import", tsxLoader, internalPath], {
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (analysis.error || analysis.status !== 0) throw new Error("ROI_HYPOTHESIS_INTERNAL_FAILED");

  const workspaceJson = join(workspace, OUT_JSON);
  const workspaceMarkdown = join(workspace, OUT_MD);
  if (!existsSync(workspaceJson)) throw new Error("ROI_HYPOTHESIS_JSON_OUTPUT_MISSING");
  if (!existsSync(workspaceMarkdown)) throw new Error("ROI_HYPOTHESIS_MARKDOWN_OUTPUT_MISSING");
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    workspaceJson,
    "ROI_HYPOTHESIS_JSON_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedMarkdownPath = assertCanonicalSingleLinkRegularFile(
    workspaceMarkdown,
    "ROI_HYPOTHESIS_MARKDOWN_OUTPUT_IDENTITY_INVALID",
  );
  const json = readFileSync(verifiedJsonPath, "utf8");
  const markdown = readFileSync(verifiedMarkdownPath, "utf8");

  mkdirSync("reports", { recursive: true });
  atomicPublish(OUT_JSON, json, "ROI_HYPOTHESIS_JSON_PUBLISH_TEMP_IDENTITY_INVALID");
  atomicPublish(OUT_MD, markdown, "ROI_HYPOTHESIS_MARKDOWN_PUBLISH_TEMP_IDENTITY_INVALID");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("[analyze-roi-hypothesis-sets] PASS: settlement preflight and isolated publication completed");

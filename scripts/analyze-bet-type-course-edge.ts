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
const BET_TYPES = ["trifecta", "trio", "exacta", "quinella"] as const;
const OUT_MD = "reports/bet-type-course-edge.md";
const OUT_JSON = "reports/bet-type-course-edge.json";
const internalPath = fileURLToPath(new URL("./analyze-bet-type-course-edge-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

function atomicPublish(path: string, content: string, tempErrorCode: string, destinationErrorCode: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode);
    if (existsSync(path)) assertCanonicalSingleLinkRegularFile(path, destinationErrorCode);
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

if (!existsSync(DB_PATH)) {
  throw new Error("BET_TYPE_COURSE_PRIMARY_DB_MISSING");
}

const dbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID");
const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout = 5000;");

type BuyRow = { race_id: string };
type PayoutRow = {
  race_id: string;
  bet_type: string;
  combination: string;
  payout_yen: number | null;
  returned: number | null;
};

const returnedBuy = db.prepare(`
  SELECT COUNT(*) AS count
  FROM decision_history
  WHERE decision='BUY' AND run_kind='historical-backfill'
    AND (returned IS NULL OR returned != 0)
    AND result IS NOT NULL AND result != ''
`).get() as { count: number };

if (Number(returnedBuy.count) > 0) {
  throw new Error(`BET_TYPE_COURSE_RETURNED_BUY_UNSUPPORTED ${JSON.stringify({ count: Number(returnedBuy.count) })}`);
}

const rows = db.prepare(`
  SELECT race_id
  FROM decision_history
  WHERE decision='BUY' AND run_kind='historical-backfill'
    AND returned = 0
    AND result IS NOT NULL AND result != ''
`).all() as BuyRow[];

const seenSettlementKeys = new Set<string>();
const settledRaceByType = new Map<string, Set<string>>(BET_TYPES.map(bt => [bt, new Set<string>()]));

for (const p of db.prepare(`
  SELECT race_id, bet_type, combination, payout_yen, returned
  FROM race_payouts
  WHERE bet_type IN ('exacta','quinella','trifecta','trio')
`).all() as PayoutRow[]) {
  const key = `${p.race_id}|${p.bet_type}|${p.combination}`;
  if (seenSettlementKeys.has(key)) {
    throw new Error(`BET_TYPE_COURSE_PAYOUT_DUPLICATE_COMBINATION ${key}`);
  }
  seenSettlementKeys.add(key);

  if (p.returned !== 0 && p.returned !== 1) {
    throw new Error(`BET_TYPE_COURSE_PAYOUT_RETURN_STATE_INVALID ${key}`);
  }
  const isPositivePayout = p.payout_yen != null && p.payout_yen > 0;
  if (p.returned === 0 && !isPositivePayout) {
    throw new Error(`BET_TYPE_COURSE_PAYOUT_INVALID_LINE ${key}`);
  }
  if (p.returned === 0 && isPositivePayout) {
    settledRaceByType.get(p.bet_type)?.add(p.race_id);
  }
}

assertPayoutCompleteness();
db.close();

function assertPayoutCompleteness(): void {
  const raceIds = new Set(rows.map(row => row.race_id));
  if (raceIds.size <= 0) throw new Error("BET_TYPE_COURSE_BUY_POPULATION_EMPTY");

  const coverage = Object.fromEntries(BET_TYPES.map(bt => {
    const settled = [...raceIds].filter(raceId => settledRaceByType.get(bt)?.has(raceId)).length;
    return [bt, { total: raceIds.size, settled }];
  }));
  const invalid = BET_TYPES.some(bt => coverage[bt].settled !== coverage[bt].total);
  if (invalid) {
    throw new Error(`BET_TYPE_COURSE_PAYOUT_COVERAGE_INCOMPLETE ${JSON.stringify(coverage)}`);
  }
}

const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  dbPath,
  "BET_TYPE_COURSE_DB_HANDOFF_IDENTITY_INVALID",
);

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-bet-type-course-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const launchDbPath = assertCanonicalSingleLinkRegularFile(
    handoffDbPath,
    "BET_TYPE_COURSE_DB_CHILD_LAUNCH_IDENTITY_INVALID",
  );
  const analysis = spawnSync(process.execPath, ["--import", tsxLoader, internalPath], {
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (analysis.error || analysis.status !== 0) throw new Error("BET_TYPE_COURSE_INTERNAL_FAILED");

  const workspaceMd = join(workspace, OUT_MD);
  const workspaceJson = join(workspace, OUT_JSON);
  if (!existsSync(workspaceMd)) throw new Error("BET_TYPE_COURSE_MD_OUTPUT_MISSING");
  if (!existsSync(workspaceJson)) throw new Error("BET_TYPE_COURSE_JSON_OUTPUT_MISSING");
  const verifiedMdPath = assertCanonicalSingleLinkRegularFile(
    workspaceMd,
    "BET_TYPE_COURSE_MD_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    workspaceJson,
    "BET_TYPE_COURSE_JSON_OUTPUT_IDENTITY_INVALID",
  );
  const markdown = readFileSync(verifiedMdPath, "utf8")
    .split(launchDbPath)
    .join("verified read-only research DB");
  const json = readFileSync(verifiedJsonPath, "utf8")
    .split(launchDbPath)
    .join("verified read-only research DB");

  mkdirSync("reports", { recursive: true });
  atomicPublish(
    OUT_MD,
    markdown,
    "BET_TYPE_COURSE_MD_PUBLISH_TEMP_IDENTITY_INVALID",
    "BET_TYPE_COURSE_MD_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_JSON,
    json,
    "BET_TYPE_COURSE_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
    "BET_TYPE_COURSE_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

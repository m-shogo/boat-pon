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
const OUT_MD = "reports/miss-to-bet-type-recovery.md";
const OUT_JSON = "reports/miss-to-bet-type-recovery.json";
const OPAQUE_DB_SOURCE = "primary research database";
const BET_TYPES = ["trifecta", "trio", "exacta", "quinella", "wide"] as const;
const internalPath = fileURLToPath(new URL("./analyze-miss-to-bet-type-recovery-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

if (!existsSync(DB_PATH)) {
  throw new Error("MISS_RECOVERY_DB_NOT_FOUND");
}

const dbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID");
const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout = 5000;");

type RawRow = { race_id: string };
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
  throw new Error(`MISS_RECOVERY_RETURNED_BUY_UNSUPPORTED ${JSON.stringify({ count: Number(returnedBuy.count) })}`);
}

const rows = db.prepare(`
  SELECT race_id
  FROM decision_history
  WHERE decision='BUY' AND run_kind='historical-backfill'
    AND returned = 0
    AND result IS NOT NULL AND result != ''
`).all() as RawRow[];

const seenSettlementKeys = new Set<string>();
const settledRaceByType = new Map<string, Set<string>>(BET_TYPES.map(bt => [bt, new Set<string>()]));

for (const p of db.prepare(`
  SELECT race_id, bet_type, combination, payout_yen, returned
  FROM race_payouts
  WHERE bet_type IN ('exacta','quinella','wide','trifecta','trio')
`).all() as PayoutRow[]) {
  const key = `${p.race_id}|${p.bet_type}|${p.combination}`;
  if (seenSettlementKeys.has(key)) {
    throw new Error(`MISS_RECOVERY_PAYOUT_DUPLICATE_COMBINATION ${key}`);
  }
  seenSettlementKeys.add(key);

  if (p.returned !== 0 && p.returned !== 1) {
    throw new Error(`MISS_RECOVERY_PAYOUT_RETURN_STATE_INVALID ${key}`);
  }
  const isPositivePayout = p.payout_yen != null && p.payout_yen > 0;
  if (p.returned === 0 && !isPositivePayout) {
    throw new Error(`MISS_RECOVERY_PAYOUT_INVALID_LINE ${key}`);
  }
  if (p.returned === 0 && isPositivePayout) {
    settledRaceByType.get(p.bet_type)?.add(p.race_id);
  }
}

assertPayoutCompleteness();
db.close();

function assertPayoutCompleteness(): void {
  const raceIds = new Set(rows.map(row => row.race_id));
  if (raceIds.size <= 0) throw new Error("MISS_RECOVERY_BUY_POPULATION_EMPTY");

  const coverage = Object.fromEntries(BET_TYPES.map(bt => {
    const settled = [...raceIds].filter(raceId => settledRaceByType.get(bt)?.has(raceId)).length;
    return [bt, { total: raceIds.size, settled }];
  }));
  const invalid = BET_TYPES.some(bt => coverage[bt].settled !== coverage[bt].total);
  if (invalid) {
    throw new Error(`MISS_RECOVERY_PAYOUT_COVERAGE_INCOMPLETE ${JSON.stringify(coverage)}`);
  }
}

function atomicPublish(path: string, content: string, code: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;

    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(
      tempPath,
      `MISS_RECOVERY_${code}_PUBLISH_TEMP_IDENTITY_INVALID`,
    );
    if (existsSync(path)) {
      assertCanonicalSingleLinkRegularFile(
        path,
        `MISS_RECOVERY_${code}_PUBLISH_DESTINATION_IDENTITY_INVALID`,
      );
    }
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

function redactDbProvenance(content: string, dbPath: string, code: string, requireProvenance: boolean): string {
  if (requireProvenance && !content.includes(dbPath)) {
    throw new Error(`MISS_RECOVERY_${code}_DB_PROVENANCE_NOT_FOUND`);
  }
  const redacted = content.split(dbPath).join(OPAQUE_DB_SOURCE);
  if (redacted.includes(dbPath)) {
    throw new Error(`MISS_RECOVERY_${code}_PRIVATE_DB_PATH_REMAINS`);
  }
  return redacted;
}

const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  dbPath,
  "MISS_RECOVERY_DB_HANDOFF_IDENTITY_INVALID",
);
const launchDbPath = assertCanonicalSingleLinkRegularFile(
  handoffDbPath,
  "MISS_RECOVERY_CHILD_LAUNCH_DB_IDENTITY_INVALID",
);
const workspace = mkdtempSync(join(tmpdir(), "boat-pon-miss-recovery-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const loader = `await import(${JSON.stringify(pathToFileURL(internalPath).href)})`;
  const analysis = spawnSync(
    process.execPath,
    ["--import", tsxLoader, "--input-type=module", "--eval", loader],
    {
      cwd: workspace,
      env: { ...process.env, BOAT_PON_DB_PATH: launchDbPath },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (analysis.error || analysis.status !== 0) {
    throw new Error("MISS_RECOVERY_INTERNAL_FAILED");
  }

  const stagedMdPath = join(workspace, OUT_MD);
  const stagedJsonPath = join(workspace, OUT_JSON);
  if (!existsSync(stagedMdPath)) throw new Error("MISS_RECOVERY_MD_OUTPUT_MISSING");
  if (!existsSync(stagedJsonPath)) throw new Error("MISS_RECOVERY_JSON_OUTPUT_MISSING");

  const verifiedMdPath = assertCanonicalSingleLinkRegularFile(
    stagedMdPath,
    "MISS_RECOVERY_MD_STAGED_OUTPUT_IDENTITY_INVALID",
  );
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    stagedJsonPath,
    "MISS_RECOVERY_JSON_STAGED_OUTPUT_IDENTITY_INVALID",
  );
  const markdown = redactDbProvenance(readFileSync(verifiedMdPath, "utf8"), launchDbPath, "MD", true);
  const json = redactDbProvenance(readFileSync(verifiedJsonPath, "utf8"), launchDbPath, "JSON", false);

  mkdirSync("reports", { recursive: true });
  atomicPublish(OUT_MD, markdown, "MD");
  atomicPublish(OUT_JSON, json, "JSON");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

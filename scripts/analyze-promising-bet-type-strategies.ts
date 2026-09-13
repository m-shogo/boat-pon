import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const BET_TYPES = ["trifecta", "trio", "exacta", "quinella", "wide"] as const;
const internalPath = fileURLToPath(new URL("./analyze-promising-bet-type-strategies-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");
const OUTPUTS = [
  { staged: "reports/promising-bet-type-strategies.md", destination: "reports/promising-bet-type-strategies.md", code: "MD" },
  { staged: "reports/promising-bet-type-strategies.json", destination: "reports/promising-bet-type-strategies.json", code: "JSON" },
] as const;

if (!existsSync(DB_PATH)) {
  throw new Error("PROMISING_BET_PRIMARY_DB_MISSING");
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
  db.close();
  throw new Error(`PROMISING_BET_RETURNED_BUY_UNSUPPORTED ${JSON.stringify({ count: Number(returnedBuy.count) })}`);
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
const returnedRaceByType = new Map<string, Set<string>>(BET_TYPES.map(bt => [bt, new Set<string>()]));

for (const p of db.prepare(`
  SELECT race_id, bet_type, combination, payout_yen, returned
  FROM race_payouts
  WHERE bet_type IN ('exacta','quinella','wide','trifecta','trio')
`).all() as PayoutRow[]) {
  const key = `${p.race_id}|${p.bet_type}|${p.combination}`;
  if (seenSettlementKeys.has(key)) {
    db.close();
    throw new Error(`PROMISING_BET_PAYOUT_DUPLICATE_COMBINATION ${key}`);
  }
  seenSettlementKeys.add(key);

  if (p.returned !== 0 && p.returned !== 1) {
    db.close();
    throw new Error(`PROMISING_BET_PAYOUT_RETURN_STATE_INVALID ${key}`);
  }
  const isPositivePayout = p.payout_yen != null && p.payout_yen > 0;
  if (p.returned === 0 && !isPositivePayout) {
    db.close();
    throw new Error(`PROMISING_BET_PAYOUT_INVALID_LINE ${key}`);
  }
  if (p.returned === 0 && isPositivePayout) {
    settledRaceByType.get(p.bet_type)?.add(p.race_id);
  }
  if (p.returned === 1) {
    returnedRaceByType.get(p.bet_type)?.add(p.race_id);
  }
}

assertPayoutCompleteness();
db.close();

function assertPayoutCompleteness(): void {
  const raceIds = new Set(rows.map(row => row.race_id));
  if (raceIds.size <= 0) throw new Error("PROMISING_BET_BUY_POPULATION_EMPTY");

  const partialReturns = Object.fromEntries(BET_TYPES.map(bt => {
    const affected = [...raceIds].filter(raceId => returnedRaceByType.get(bt)?.has(raceId)).length;
    return [bt, affected];
  }));
  if (BET_TYPES.some(bt => partialReturns[bt] > 0)) {
    throw new Error(`PROMISING_BET_PARTIAL_RETURN_UNSUPPORTED ${JSON.stringify(partialReturns)}`);
  }

  const coverage = Object.fromEntries(BET_TYPES.map(bt => {
    const settled = [...raceIds].filter(raceId => settledRaceByType.get(bt)?.has(raceId)).length;
    return [bt, { total: raceIds.size, settled }];
  }));
  const invalid = BET_TYPES.some(bt => coverage[bt].settled !== coverage[bt].total);
  if (invalid) {
    throw new Error(`PROMISING_BET_PAYOUT_COVERAGE_INCOMPLETE ${JSON.stringify(coverage)}`);
  }
}

function assertCanonicalDirectory(path: string, code: string): string {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(code);
  const resolvedPath = resolve(path);
  if (realpathSync(path) !== resolvedPath) throw new Error(code);
  return resolvedPath;
}

function atomicPublish(path: string, content: string, code: string): void {
  const parentPath = dirname(path);
  assertCanonicalDirectory(parentPath, `PROMISING_BET_${code}_PUBLISH_PARENT_IDENTITY_INVALID`);
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
      `PROMISING_BET_${code}_PUBLISH_TEMP_IDENTITY_INVALID`,
    );
    if (existsSync(path)) {
      assertCanonicalSingleLinkRegularFile(
        path,
        `PROMISING_BET_${code}_PUBLISH_DESTINATION_IDENTITY_INVALID`,
      );
    }
    assertCanonicalDirectory(parentPath, `PROMISING_BET_${code}_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID`);
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

if (!existsSync(DB_PATH)) {
  throw new Error("PROMISING_BET_PRIMARY_DB_MISSING");
}
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "PROMISING_BET_DB_HANDOFF_IDENTITY_INVALID",
);

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-promising-bet-"));
try {
  mkdirSync(join(workspace, "reports"), { recursive: true });
  const childDbPath = assertCanonicalSingleLinkRegularFile(
    verifiedDbPath,
    "PROMISING_BET_DB_CHILD_HANDOFF_IDENTITY_INVALID",
  );
  const result = spawnSync(process.execPath, ["--import", tsxLoader, internalPath], {
    stdio: "inherit",
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: childDbPath },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`PROMISING_BET_INTERNAL_ANALYZER_FAILED status=${result.status ?? "unknown"}`);
  }

  const stagedOutputs = OUTPUTS.map((output) => {
    const stagedPath = join(workspace, output.staged);
    const verifiedStagedPath = assertCanonicalSingleLinkRegularFile(
      stagedPath,
      `PROMISING_BET_${output.code}_STAGED_OUTPUT_IDENTITY_INVALID`,
    );
    return { output, verifiedStagedPath };
  });
  const preparedOutputs = stagedOutputs.map(({ output, verifiedStagedPath }) => {
    const readPath = assertCanonicalSingleLinkRegularFile(
      verifiedStagedPath,
      `PROMISING_BET_${output.code}_STAGED_READ_IDENTITY_INVALID`,
    );
    const content = readFileSync(readPath, "utf8");
    assertCanonicalSingleLinkRegularFile(
      readPath,
      `PROMISING_BET_${output.code}_STAGED_HANDOFF_IDENTITY_INVALID`,
    );
    return { output, content };
  });

  mkdirSync("reports", { recursive: true });
  assertCanonicalDirectory("reports", "PROMISING_BET_REPORTS_DIRECTORY_IDENTITY_INVALID");
  for (const { output, content } of preparedOutputs) {
    atomicPublish(output.destination, content, output.code);
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

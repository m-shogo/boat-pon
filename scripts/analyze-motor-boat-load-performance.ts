/**
 * motor_boat_stats の全件ロードと対象race_idロードの読み取り専用性能確認。
 */

import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, resolve } from "node:path";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/motor-boat-load-performance.md";
const OUT_JSON = "reports/motor-boat-load-performance.json";

if (!existsSync(DB_PATH)) throw new Error("MOTOR_BOAT_LOAD_PERFORMANCE_DB_UNAVAILABLE");
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "MOTOR_BOAT_LOAD_PERFORMANCE_DB_IDENTITY_INVALID",
);
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

try {
  const indexes = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='motor_boat_stats' ORDER BY name").all();
  const total = time("full load", () => db.prepare("SELECT race_id, course, motor_top2_rate, boat_top2_rate FROM motor_boat_stats WHERE motor_top2_rate IS NOT NULL OR boat_top2_rate IS NOT NULL").all());
  const targetRaceIds = db.prepare(`
SELECT DISTINCT race_id FROM decision_history
WHERE run_kind='historical-backfill' AND decision='BUY' AND current_odds IS NOT NULL AND result IS NOT NULL
`).all() as Array<{ race_id: string }>;
  const scoped = time("scoped load", () => {
    let n = 0;
    for (const ids of chunks(targetRaceIds.map((r) => r.race_id), 500)) {
      n += db.prepare(`SELECT race_id, course, motor_top2_rate, boat_top2_rate FROM motor_boat_stats WHERE race_id IN (${ids.map(() => "?").join(",")})`).all(...ids).length;
    }
    return { length: n };
  });
  const report = { generatedAt: new Date().toISOString(), indexes, total, scoped, targetRaceIds: targetRaceIds.length };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = renderMarkdown(report);
  mkdirSync("reports", { recursive: true });
  assertCanonicalDirectory("reports", "MOTOR_BOAT_LOAD_REPORTS_DIRECTORY_IDENTITY_INVALID");
  verifyExistingOutput(OUT_JSON, "MOTOR_BOAT_LOAD_PREEXISTING_JSON_IDENTITY_INVALID");
  verifyExistingOutput(OUT_MD, "MOTOR_BOAT_LOAD_PREEXISTING_MD_IDENTITY_INVALID");
  atomicPublish(
    OUT_JSON,
    json,
    "MOTOR_BOAT_LOAD_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
    "MOTOR_BOAT_LOAD_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_MD,
    markdown,
    "MOTOR_BOAT_LOAD_MD_PUBLISH_TEMP_IDENTITY_INVALID",
    "MOTOR_BOAT_LOAD_MD_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
  console.log(`[analyze-motor-boat-load-performance] wrote ${OUT_MD}`);
  console.log(`[analyze-motor-boat-load-performance] wrote ${OUT_JSON}`);
} finally {
  db.close();
}

function assertCanonicalDirectory(path: string, errorCode: string): string {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(errorCode);
  const resolvedPath = resolve(path);
  if (realpathSync(path) !== resolvedPath) throw new Error(errorCode);
  return resolvedPath;
}

function verifyExistingOutput(path: string, identityErrorCode: string): void {
  if (!existsSync(path)) return;
  assertCanonicalSingleLinkRegularFile(path, identityErrorCode);
}

function atomicPublish(
  path: string,
  contents: string,
  tempIdentityErrorCode: string,
  destinationIdentityErrorCode: string,
): void {
  const parentPath = dirname(path);
  assertCanonicalDirectory(parentPath, "MOTOR_BOAT_LOAD_PUBLISH_PARENT_IDENTITY_INVALID");
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, contents, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, tempIdentityErrorCode);
    if (existsSync(path)) {
      assertCanonicalSingleLinkRegularFile(path, destinationIdentityErrorCode);
    }
    assertCanonicalDirectory(parentPath, "MOTOR_BOAT_LOAD_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID");
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

function time<T extends { length?: number }>(label: string, fn: () => T) {
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  return { label, rows: result.length ?? 0, ms: Number(ms.toFixed(2)) };
}

function renderMarkdown(report: { indexes: unknown[]; total: { rows: number; ms: number }; scoped: { rows: number; ms: number }; targetRaceIds: number }) {
  return `# motor_boat_stats load performance

## 結果
| mode | rows | ms |
|---|---:|---:|
| full load | ${report.total.rows} | ${report.total.ms} |
| scoped historical BUY race_ids | ${report.scoped.rows} | ${report.scoped.ms} |

target race_ids: ${report.targetRaceIds}

## index
\`\`\`json
${JSON.stringify(report.indexes, null, 2)}
\`\`\`

## 提案
- \`loadMotorBoatStatsMap(db)\` は全件ロードではなく \`loadMotorBoatStatsMapForRaceIds(db, raceIds)\` にする。
- \`listProgramInputsRange\` 系では、先に対象program rowsを取得し、そのrace_idだけで \`motor_boat_stats\` を読む。
- keyは現状どおり \`race_id-course\` を維持する。
- 本番変更前に、同一race_idのfeature snapshot一致テストを追加する。
`;
}

function chunks<T>(xs: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
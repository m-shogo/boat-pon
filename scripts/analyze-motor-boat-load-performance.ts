/**
 * motor_boat_stats の全件ロードと対象race_idロードの読み取り専用性能確認。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/motor-boat-load-performance.md";

if (!existsSync(DB_PATH)) throw new Error(`DB not found: ${DB_PATH}`);
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

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
  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/motor-boat-load-performance.json", `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUT_MD, renderMarkdown(report));
  console.log(`[analyze-motor-boat-load-performance] wrote ${OUT_MD}`);
  console.log("[analyze-motor-boat-load-performance] wrote reports/motor-boat-load-performance.json");
} finally {
  db.close();
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

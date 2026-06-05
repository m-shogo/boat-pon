/**
 * BUY にしたが的中しなかった行を確認する read-only レポート。
 *
 * 目的:
 * - BUY 条件が甘すぎないか確認する
 * - 高EV / 高オッズ / 低サンプル / 環境リスクなどの失敗パターンを探す
 * - decision_reasons と合わせて改善候補を探す
 *
 * 注意:
 * - 読み取り専用
 * - 外部アクセスなし
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error(`[report-buy-misses] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

try {
  const rows = queryRows();
  if (args.json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), args, rows }, null, 2));
  } else {
    printRows(rows);
  }
} finally {
  db.close();
}

type ReportRow = {
  date: string;
  venue: string;
  raceNo: number;
  selection: string;
  result: string | null;
  estimatedHitRate: number | null;
  requiredOdds: number | null;
  currentOdds: number | null;
  ev: number | null;
  sampleSize: number | null;
  modelVersion: string | null;
  runKind: string | null;
  decisionReasons: string | null;
};

function queryRows(): ReportRow[] {
  const where: string[] = ["decision = 'BUY'", "returned = 0", "(result IS NULL OR selection != result)"];
  const params: Array<string | number> = [];

  if (args.from) { where.push("date >= ?"); params.push(args.from); }
  if (args.to) { where.push("date <= ?"); params.push(args.to); }
  if (args.venue) { where.push("venue = ?"); params.push(args.venue); }
  if (args.modelVersion) { where.push("model_version = ?"); params.push(args.modelVersion); }
  if (args.runKind) { where.push("run_kind = ?"); params.push(args.runKind); }
  params.push(args.limit);

  const hasDecisionReasons = columnExists("decision_reasons");
  const reasonsSelect = hasDecisionReasons ? "decision_reasons" : "NULL AS decision_reasons";

  const sql = `
SELECT
  date,
  venue,
  race_no AS raceNo,
  selection,
  result,
  estimated_hit_rate AS estimatedHitRate,
  required_odds AS requiredOdds,
  current_odds AS currentOdds,
  ev,
  sample_size AS sampleSize,
  model_version AS modelVersion,
  run_kind AS runKind,
  ${reasonsSelect}
FROM decision_history
WHERE ${where.join(" AND ")}
ORDER BY ev DESC, current_odds DESC, date DESC, venue ASC, race_no ASC
LIMIT ?
`;

  return db.prepare(sql).all(...params) as ReportRow[];
}

function printRows(rows: ReportRow[]) {
  console.log("=== BUY misses report ===");
  console.log(`generated: ${new Date().toISOString()}`);
  console.log(`filters: from=${args.from ?? "-"} to=${args.to ?? "-"} venue=${args.venue ?? "-"} model=${args.modelVersion ?? "-"} runKind=${args.runKind ?? "-"}`);
  console.log("");
  console.log("date        venue      R   selection  result     odds    ev      est     req     sample  reasons");
  for (const row of rows) {
    console.log([
      row.date.padEnd(10),
      row.venue.padEnd(9),
      String(row.raceNo).padStart(2),
      row.selection.padEnd(9),
      String(row.result ?? "-").padEnd(8),
      format(row.currentOdds).padStart(7),
      format(row.ev).padStart(7),
      format(row.estimatedHitRate).padStart(7),
      format(row.requiredOdds).padStart(7),
      String(row.sampleSize ?? "-").padStart(6),
      summarizeReasons(row.decisionReasons),
    ].join("  "));
  }
}

function summarizeReasons(value: string | null) {
  if (!value) return "-";
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return "-";
    return parsed.slice(0, 3).map(String).join(" / ") || "-";
  } catch {
    return "-";
  }
}

function columnExists(column: string): boolean {
  const rows = db.prepare("PRAGMA table_info(decision_history)").all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function format(value: number | null) {
  return value == null ? "-" : value.toFixed(3);
}

function parseArgs(argv: string[]) {
  const parsed = {
    from: null as string | null,
    to: null as string | null,
    venue: null as string | null,
    modelVersion: null as string | null,
    runKind: null as string | null,
    limit: 100,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--from") { parsed.from = normalizeDate(value); i += 1; }
    else if (key === "--to") { parsed.to = normalizeDate(value); i += 1; }
    else if (key === "--venue") { parsed.venue = String(value ?? ""); i += 1; }
    else if (key === "--model-version") { parsed.modelVersion = String(value ?? ""); i += 1; }
    else if (key === "--run-kind") { parsed.runKind = String(value ?? ""); i += 1; }
    else if (key === "--limit") { parsed.limit = Math.max(1, Math.min(1000, Number(value))); i += 1; }
    else if (key === "--json") parsed.json = true;
    else if (key === "--help" || key === "-h") { printHelp(); process.exit(0); }
    else if (key === "--") { /* pnpm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }

  return parsed;
}

function normalizeDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`date must be YYYY-MM-DD: ${value ?? ""}`);
  return value;
}

function printHelp() {
  console.log(`Usage:
  pnpm exec tsx scripts/report-buy-misses.ts -- --from YYYY-MM-DD --to YYYY-MM-DD [--venue 蒲郡] [--limit 100] [--json]

Read-only. No external access.`);
}

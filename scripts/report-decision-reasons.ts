/**
 * decision_history.decision_reasons を集計する読み取り専用レポート。
 *
 * 目的:
 * - BUY/WATCH/SKIP の理由別に n / hit / ROI(current_odds基準) を確認する
 * - どの除外理由・警告理由が本当に効いているかを後から検証する
 *
 * 注意:
 * - 読み取り専用
 * - 自動投票・ログイン保存・外部fetchなし
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error(`[report-decision-reasons] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

try {
  if (!columnExists("decision_history", "decision_reasons")) {
    console.error("[report-decision-reasons] decision_reasons column is missing. Run: pnpm migrate:decision-audit");
    process.exit(1);
  }

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
  decision: string;
  reason: string;
  n: number;
  settled: number;
  hits: number;
  roi: number | null;
  avgCurrentOdds: number | null;
  avgRequiredOdds: number | null;
};

function queryRows(): ReportRow[] {
  const where: string[] = ["1=1"];
  const params: Array<string | number> = [];

  if (args.from) { where.push("date >= ?"); params.push(args.from); }
  if (args.to) { where.push("date <= ?"); params.push(args.to); }
  if (args.decision) { where.push("decision = ?"); params.push(args.decision); }
  if (args.modelVersion) { where.push("model_version = ?"); params.push(args.modelVersion); }
  if (args.runKind) { where.push("run_kind = ?"); params.push(args.runKind); }

  const sql = `
WITH reason_rows AS (
  SELECT
    dh.decision,
    COALESCE(NULLIF(j.value, ''), '(reason-empty)') AS reason,
    dh.selection,
    dh.result,
    dh.returned,
    dh.current_odds,
    dh.required_odds
  FROM decision_history dh
  JOIN json_each(CASE
    WHEN json_valid(dh.decision_reasons) THEN dh.decision_reasons
    ELSE '[]'
  END) AS j
  WHERE ${where.join(" AND ")}
)
SELECT
  decision,
  reason,
  COUNT(*) AS n,
  SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END) AS settled,
  SUM(CASE WHEN selection = result AND returned = 0 THEN 1 ELSE 0 END) AS hits,
  ROUND(
    SUM(CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END) * 1.0
    / NULLIF(SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END), 0),
    3
  ) AS roi,
  ROUND(AVG(current_odds), 2) AS avg_current_odds,
  ROUND(AVG(required_odds), 2) AS avg_required_odds
FROM reason_rows
GROUP BY decision, reason
ORDER BY decision, n DESC, reason ASC
LIMIT ?
`;

  params.push(args.limit);
  return db.prepare(sql).all(...params) as ReportRow[];
}

function printRows(rows: ReportRow[]) {
  console.log("=== decision reasons report ===");
  console.log(`generated: ${new Date().toISOString()}`);
  console.log(`filters: from=${args.from ?? "-"} to=${args.to ?? "-"} decision=${args.decision ?? "-"} model=${args.modelVersion ?? "-"} runKind=${args.runKind ?? "-"}`);
  console.log("");
  console.log("decision  n      settled  hits   roi     avgOdds  avgReq   reason");
  for (const row of rows) {
    console.log([
      row.decision.padEnd(8),
      String(row.n).padStart(6),
      String(row.settled).padStart(7),
      String(row.hits).padStart(5),
      format(row.roi).padStart(7),
      format(row.avgCurrentOdds).padStart(7),
      format(row.avgRequiredOdds).padStart(7),
      row.reason,
    ].join("  "));
  }
}

function format(value: number | null) {
  return value == null ? "-" : value.toFixed(3);
}

function columnExists(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function parseArgs(argv: string[]) {
  const parsed = {
    from: null as string | null,
    to: null as string | null,
    decision: null as string | null,
    modelVersion: null as string | null,
    runKind: null as string | null,
    limit: 200,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--from") { parsed.from = normalizeDate(value); i += 1; }
    else if (key === "--to") { parsed.to = normalizeDate(value); i += 1; }
    else if (key === "--decision") { parsed.decision = String(value ?? "").toUpperCase(); i += 1; }
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
  pnpm report:decision-reasons -- --from YYYY-MM-DD --to YYYY-MM-DD [--decision BUY|WATCH|SKIP] [--model-version X] [--run-kind paper-live] [--json]

Read-only. No external fetch. No betting.`);
}

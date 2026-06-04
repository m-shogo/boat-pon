/**
 * 最大配当依存をより厳しく見る read-only レポート。
 *
 * 目的:
 * - ROI が最大配当1本/上位3本/上位5本に依存していないか確認する
 * - decision別・会場別などで安定性を見る
 *
 * 注意:
 * - 読み取り専用
 * - 外部アクセスなし
 * - 自動購入・投票操作なし
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error(`[report-payout-sensitivity] DB not found: ${DB_PATH}`);
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
  groupKey: string;
  n: number;
  settled: number;
  hits: number;
  hitRate: number | null;
  totalPayoutOdds: number | null;
  roi: number | null;
  roiExTop1: number | null;
  roiExTop3: number | null;
  roiExTop5: number | null;
  top1PayoutOdds: number | null;
  top3PayoutOdds: number | null;
  top5PayoutOdds: number | null;
};

function queryRows(): ReportRow[] {
  const groupExpr = groupByExpr(args.groupBy);
  const where: string[] = ["1=1"];
  const params: Array<string | number> = [];

  if (args.from) { where.push("date >= ?"); params.push(args.from); }
  if (args.to) { where.push("date <= ?"); params.push(args.to); }
  if (args.venue) { where.push("venue = ?"); params.push(args.venue); }
  if (args.decision) { where.push("decision = ?"); params.push(args.decision); }
  if (args.modelVersion) { where.push("model_version = ?"); params.push(args.modelVersion); }
  if (args.runKind) { where.push("run_kind = ?"); params.push(args.runKind); }

  const sql = `
WITH base AS (
  SELECT
    ${groupExpr} AS groupKey,
    decision,
    selection,
    result,
    returned,
    current_odds,
    CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END AS payout_odds
  FROM decision_history
  WHERE ${where.join(" AND ")}
), ranked_hits AS (
  SELECT
    groupKey,
    payout_odds,
    ROW_NUMBER() OVER (PARTITION BY groupKey ORDER BY payout_odds DESC) AS payout_rank
  FROM base
  WHERE payout_odds > 0
), grouped AS (
  SELECT
    groupKey,
    COUNT(*) AS n,
    SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END) AS settled,
    SUM(CASE WHEN selection = result AND returned = 0 THEN 1 ELSE 0 END) AS hits,
    SUM(payout_odds) AS total_payout_odds
  FROM base
  GROUP BY groupKey
), top AS (
  SELECT
    groupKey,
    SUM(CASE WHEN payout_rank <= 1 THEN payout_odds ELSE 0 END) AS top1_payout_odds,
    SUM(CASE WHEN payout_rank <= 3 THEN payout_odds ELSE 0 END) AS top3_payout_odds,
    SUM(CASE WHEN payout_rank <= 5 THEN payout_odds ELSE 0 END) AS top5_payout_odds,
    SUM(CASE WHEN payout_rank <= 1 THEN 1 ELSE 0 END) AS top1_hits,
    SUM(CASE WHEN payout_rank <= 3 THEN 1 ELSE 0 END) AS top3_hits,
    SUM(CASE WHEN payout_rank <= 5 THEN 1 ELSE 0 END) AS top5_hits
  FROM ranked_hits
  GROUP BY groupKey
)
SELECT
  g.groupKey,
  g.n,
  g.settled,
  g.hits,
  ROUND(g.hits * 1.0 / NULLIF(g.settled, 0), 4) AS hitRate,
  ROUND(g.total_payout_odds, 2) AS totalPayoutOdds,
  ROUND(g.total_payout_odds * 1.0 / NULLIF(g.settled, 0), 3) AS roi,
  ROUND((g.total_payout_odds - COALESCE(t.top1_payout_odds, 0)) * 1.0 / NULLIF(g.settled - COALESCE(t.top1_hits, 0), 0), 3) AS roiExTop1,
  ROUND((g.total_payout_odds - COALESCE(t.top3_payout_odds, 0)) * 1.0 / NULLIF(g.settled - COALESCE(t.top3_hits, 0), 0), 3) AS roiExTop3,
  ROUND((g.total_payout_odds - COALESCE(t.top5_payout_odds, 0)) * 1.0 / NULLIF(g.settled - COALESCE(t.top5_hits, 0), 0), 3) AS roiExTop5,
  ROUND(COALESCE(t.top1_payout_odds, 0), 2) AS top1PayoutOdds,
  ROUND(COALESCE(t.top3_payout_odds, 0), 2) AS top3PayoutOdds,
  ROUND(COALESCE(t.top5_payout_odds, 0), 2) AS top5PayoutOdds
FROM grouped g
LEFT JOIN top t ON t.groupKey = g.groupKey
ORDER BY g.groupKey
`;

  return db.prepare(sql).all(...params) as ReportRow[];
}

function groupByExpr(groupBy: string) {
  if (groupBy === "decision") return "decision";
  if (groupBy === "venue") return "venue";
  if (groupBy === "month") return "substr(date, 1, 7)";
  if (groupBy === "venue-month") return "venue || ':' || substr(date, 1, 7)";
  return "'all'";
}

function printRows(rows: ReportRow[]) {
  console.log("=== payout sensitivity report ===");
  console.log(`generated: ${new Date().toISOString()}`);
  console.log(`filters: from=${args.from ?? "-"} to=${args.to ?? "-"} venue=${args.venue ?? "-"} decision=${args.decision ?? "-"} groupBy=${args.groupBy}`);
  console.log("");
  console.log("group             n      settled  hits   hitRate  roi     exTop1  exTop3  exTop5  top1    top3    top5");
  for (const row of rows) {
    console.log([
      row.groupKey.padEnd(16),
      String(row.n).padStart(6),
      String(row.settled).padStart(7),
      String(row.hits).padStart(5),
      fmt(row.hitRate).padStart(7),
      fmt(row.roi).padStart(7),
      fmt(row.roiExTop1).padStart(7),
      fmt(row.roiExTop3).padStart(7),
      fmt(row.roiExTop5).padStart(7),
      fmt(row.top1PayoutOdds).padStart(7),
      fmt(row.top3PayoutOdds).padStart(7),
      fmt(row.top5PayoutOdds).padStart(7),
    ].join("  "));
  }
}

function fmt(value: number | null) {
  return value == null ? "-" : value.toFixed(3);
}

function parseArgs(argv: string[]) {
  const parsed = {
    from: null as string | null,
    to: null as string | null,
    venue: null as string | null,
    decision: null as string | null,
    modelVersion: null as string | null,
    runKind: null as string | null,
    groupBy: "decision",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--from") { parsed.from = normalizeDate(value); i += 1; }
    else if (key === "--to") { parsed.to = normalizeDate(value); i += 1; }
    else if (key === "--venue") { parsed.venue = String(value ?? ""); i += 1; }
    else if (key === "--decision") { parsed.decision = String(value ?? "").toUpperCase(); i += 1; }
    else if (key === "--model-version") { parsed.modelVersion = String(value ?? ""); i += 1; }
    else if (key === "--run-kind") { parsed.runKind = String(value ?? ""); i += 1; }
    else if (key === "--group-by") { parsed.groupBy = String(value ?? "decision"); i += 1; }
    else if (key === "--json") parsed.json = true;
    else if (key === "--help" || key === "-h") { printHelp(); process.exit(0); }
    else throw new Error(`unknown option: ${key}`);
  }

  if (!["all", "decision", "venue", "month", "venue-month"].includes(parsed.groupBy)) {
    throw new Error("--group-by must be all, decision, venue, month, or venue-month");
  }

  return parsed;
}

function normalizeDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`date must be YYYY-MM-DD: ${value ?? ""}`);
  return value;
}

function printHelp() {
  console.log(`Usage:
  pnpm exec tsx scripts/report-payout-sensitivity.ts -- --from YYYY-MM-DD --to YYYY-MM-DD [--decision BUY] [--group-by decision|venue|month|venue-month|all] [--json]

Read-only. No external access.`);
}

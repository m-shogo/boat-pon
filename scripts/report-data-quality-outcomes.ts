/**
 * データ品質と結果の関係を見る read-only レポート。
 *
 * 目的:
 * - BUY/外れ がモデルの問題か、直前情報不足・環境リスクの問題か切り分ける
 * - beforeInfoComplete / environmentRiskLevel / sampleSize band 別に見る
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
  console.error(`[report-data-quality-outcomes] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

try {
  const rows = [
    ...queryMetric("before_info", beforeInfoBandSql()),
    ...queryMetric("environment", environmentBandSql()),
    ...queryMetric("sample_size", sampleBandSql()),
  ];

  if (args.json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), args, rows }, null, 2));
  } else {
    printRows(rows);
  }
} finally {
  db.close();
}

type ReportRow = {
  metric: string;
  band: string;
  decision: string;
  n: number;
  settled: number;
  hits: number;
  hitRate: number | null;
  roi: number | null;
  roiExMax: number | null;
  avgEstimatedHitRate: number | null;
  avgCurrentOdds: number | null;
};

function queryMetric(metric: string, bandExpr: string): ReportRow[] {
  const where: string[] = ["1=1"];
  const params: Array<string | number> = [];

  if (args.from) { where.push("date >= ?"); params.push(args.from); }
  if (args.to) { where.push("date <= ?"); params.push(args.to); }
  if (args.decision) { where.push("decision = ?"); params.push(args.decision); }
  if (args.venue) { where.push("venue = ?"); params.push(args.venue); }
  if (args.modelVersion) { where.push("model_version = ?"); params.push(args.modelVersion); }
  if (args.runKind) { where.push("run_kind = ?"); params.push(args.runKind); }

  const sql = `
WITH base AS (
  SELECT
    ${bandExpr} AS band,
    decision,
    selection,
    result,
    returned,
    estimated_hit_rate,
    current_odds,
    CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END AS payout_odds
  FROM decision_history
  WHERE ${where.join(" AND ")}
), grouped AS (
  SELECT
    band,
    decision,
    COUNT(*) AS n,
    SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END) AS settled,
    SUM(CASE WHEN selection = result AND returned = 0 THEN 1 ELSE 0 END) AS hits,
    SUM(payout_odds) AS total_payout_odds,
    MAX(payout_odds) AS max_payout_odds,
    AVG(estimated_hit_rate) AS avg_estimated_hit_rate,
    AVG(current_odds) AS avg_current_odds
  FROM base
  GROUP BY band, decision
)
SELECT
  ? AS metric,
  band,
  decision,
  n,
  settled,
  hits,
  ROUND(hits * 1.0 / NULLIF(settled, 0), 4) AS hitRate,
  ROUND(total_payout_odds * 1.0 / NULLIF(settled, 0), 3) AS roi,
  ROUND((total_payout_odds - max_payout_odds) * 1.0 / NULLIF(settled - CASE WHEN max_payout_odds > 0 THEN 1 ELSE 0 END, 0), 3) AS roiExMax,
  ROUND(avg_estimated_hit_rate, 4) AS avgEstimatedHitRate,
  ROUND(avg_current_odds, 2) AS avgCurrentOdds
FROM grouped
ORDER BY metric, band, CASE decision WHEN 'BUY' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'SKIP' THEN 3 ELSE 4 END
`;

  return db.prepare(sql).all(...params, metric) as ReportRow[];
}

function beforeInfoBandSql() {
  if (!columnExists("before_info_complete")) return "'unknown-column'";
  return `CASE
    WHEN before_info_complete = 1 THEN 'complete'
    WHEN before_info_complete = 0 THEN 'incomplete'
    ELSE 'unknown'
  END`;
}

function environmentBandSql() {
  if (!columnExists("environment_risk_level")) return "'unknown-column'";
  return `CASE
    WHEN environment_risk_level IS NULL OR environment_risk_level = '' THEN 'unknown'
    ELSE environment_risk_level
  END`;
}

function sampleBandSql() {
  return `CASE
    WHEN sample_size IS NULL THEN 'unknown'
    WHEN sample_size < 30 THEN '<30'
    WHEN sample_size < 100 THEN '30-99'
    WHEN sample_size < 300 THEN '100-299'
    ELSE '300+'
  END`;
}

function printRows(rows: ReportRow[]) {
  console.log("=== data quality outcomes report ===");
  console.log(`generated: ${new Date().toISOString()}`);
  console.log(`filters: from=${args.from ?? "-"} to=${args.to ?? "-"} venue=${args.venue ?? "-"} decision=${args.decision ?? "-"} model=${args.modelVersion ?? "-"} runKind=${args.runKind ?? "-"}`);
  console.log("");
  console.log("metric        band              decision  n      settled  hits   hitRate  roi     roiExMax  estAvg  oddsAvg");
  for (const row of rows) {
    console.log([
      row.metric.padEnd(12),
      row.band.padEnd(16),
      row.decision.padEnd(8),
      String(row.n).padStart(6),
      String(row.settled).padStart(7),
      String(row.hits).padStart(5),
      format(row.hitRate).padStart(7),
      format(row.roi).padStart(7),
      format(row.roiExMax).padStart(8),
      format(row.avgEstimatedHitRate).padStart(7),
      format(row.avgCurrentOdds).padStart(7),
    ].join("  "));
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
    decision: null as string | null,
    modelVersion: null as string | null,
    runKind: null as string | null,
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
    else if (key === "--json") parsed.json = true;
    else if (key === "--help" || key === "-h") { printHelp(); process.exit(0); }
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
  pnpm exec tsx scripts/report-data-quality-outcomes.ts -- --from YYYY-MM-DD --to YYYY-MM-DD [--venue 蒲郡] [--decision BUY|WATCH|SKIP] [--json]

Read-only. No external access.`);
}

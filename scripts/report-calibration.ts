/**
 * decision_history の校正確認レポート。
 *
 * 読み取り専用。外部アクセスなし。
 *
 * 見ること:
 * - estimated_hit_rate band
 * - required_odds band
 * - current_odds band
 * - decision 別の n / hits / ROI / ROI excluding max payout
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error(`[report-calibration] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

try {
  const rows = [
    ...queryBand("estimated_hit_rate", hitRateBandSql()),
    ...queryBand("required_odds", oddsBandSql("required_odds")),
    ...queryBand("current_odds", oddsBandSql("current_odds")),
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
  actualHitRate: number | null;
  avgEstimatedHitRate: number | null;
  avgCurrentOdds: number | null;
  roi: number | null;
  roiExMax: number | null;
  maxPayoutOdds: number | null;
};

function queryBand(metric: string, bandExpr: string): ReportRow[] {
  const where: string[] = ["1=1"];
  const params: Array<string | number> = [];

  if (args.from) { where.push("date >= ?"); params.push(args.from); }
  if (args.to) { where.push("date <= ?"); params.push(args.to); }
  if (args.decision) { where.push("decision = ?"); params.push(args.decision); }
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
    AVG(estimated_hit_rate) AS avg_estimated_hit_rate,
    AVG(current_odds) AS avg_current_odds,
    SUM(payout_odds) AS total_payout_odds,
    MAX(payout_odds) AS max_payout_odds
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
  ROUND(hits * 1.0 / NULLIF(settled, 0), 4) AS actualHitRate,
  ROUND(avg_estimated_hit_rate, 4) AS avgEstimatedHitRate,
  ROUND(avg_current_odds, 2) AS avgCurrentOdds,
  ROUND(total_payout_odds * 1.0 / NULLIF(settled, 0), 3) AS roi,
  ROUND((total_payout_odds - max_payout_odds) * 1.0 / NULLIF(settled - CASE WHEN max_payout_odds > 0 THEN 1 ELSE 0 END, 0), 3) AS roiExMax,
  ROUND(max_payout_odds, 2) AS maxPayoutOdds
FROM grouped
ORDER BY metric, band, decision
`;

  return db.prepare(sql).all(...params, metric) as ReportRow[];
}

function hitRateBandSql() {
  return `CASE
    WHEN estimated_hit_rate IS NULL THEN 'missing'
    WHEN estimated_hit_rate < 0.05 THEN '<5%'
    WHEN estimated_hit_rate < 0.10 THEN '5-10%'
    WHEN estimated_hit_rate < 0.15 THEN '10-15%'
    WHEN estimated_hit_rate < 0.20 THEN '15-20%'
    ELSE '20%+'
  END`;
}

function oddsBandSql(column: string) {
  return `CASE
    WHEN ${column} IS NULL THEN 'missing'
    WHEN ${column} < 5 THEN '<5'
    WHEN ${column} < 10 THEN '5-10'
    WHEN ${column} < 20 THEN '10-20'
    WHEN ${column} < 50 THEN '20-50'
    WHEN ${column} < 100 THEN '50-100'
    ELSE '100+'
  END`;
}

function printRows(rows: ReportRow[]) {
  console.log("=== calibration report ===");
  console.log(`generated: ${new Date().toISOString()}`);
  console.log(`filters: from=${args.from ?? "-"} to=${args.to ?? "-"} decision=${args.decision ?? "-"} model=${args.modelVersion ?? "-"} runKind=${args.runKind ?? "-"}`);
  console.log("");
  console.log("metric              band      decision  n      settled  hits   actual  estAvg  oddsAvg  roi     roiExMax  maxOdds");
  for (const row of rows) {
    console.log([
      row.metric.padEnd(18),
      row.band.padEnd(8),
      row.decision.padEnd(8),
      String(row.n).padStart(6),
      String(row.settled).padStart(7),
      String(row.hits).padStart(5),
      format(row.actualHitRate).padStart(7),
      format(row.avgEstimatedHitRate).padStart(7),
      format(row.avgCurrentOdds).padStart(7),
      format(row.roi).padStart(7),
      format(row.roiExMax).padStart(8),
      format(row.maxPayoutOdds).padStart(7),
    ].join("  "));
  }
}

function format(value: number | null) {
  return value == null ? "-" : value.toFixed(3);
}

function parseArgs(argv: string[]) {
  const parsed = {
    from: null as string | null,
    to: null as string | null,
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
  pnpm exec tsx scripts/report-calibration.ts -- --from YYYY-MM-DD --to YYYY-MM-DD [--decision BUY|WATCH|SKIP] [--model-version X] [--run-kind paper-live] [--json]

Read-only. No external access.`);
}

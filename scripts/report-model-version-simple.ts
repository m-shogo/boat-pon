/**
 * model_version 別の簡易比較レポート。
 *
 * read-only / 外部アクセスなし。
 * 新モデルが旧モデルより良いかを見る入口。
 *
 * Usage:
 *   pnpm exec tsx scripts/report-model-version-simple.ts -- --from 2026-01-01 --to 2026-06-03
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error(`[report-model-version-simple] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

try {
  const rows = queryRows();
  if (args.json) console.log(JSON.stringify({ generatedAt: new Date().toISOString(), args, rows }, null, 2));
  else printRows(rows);
} finally {
  db.close();
}

type Row = {
  modelVersion: string;
  decision: string;
  n: number;
  settled: number;
  hits: number;
  hitRate: number | null;
  avgEstimatedHitRate: number | null;
  avgCurrentOdds: number | null;
  roi: number | null;
  roiExMax: number | null;
  maxPayoutOdds: number | null;
};

function queryRows(): Row[] {
  const where: string[] = ["1=1"];
  const params: Array<string | number> = [];
  if (args.from) { where.push("date >= ?"); params.push(args.from); }
  if (args.to) { where.push("date <= ?"); params.push(args.to); }
  if (args.decision) { where.push("decision = ?"); params.push(args.decision); }
  if (args.venue) { where.push("venue = ?"); params.push(args.venue); }
  if (args.runKind) { where.push("run_kind = ?"); params.push(args.runKind); }
  params.push(args.minSettled);

  return db.prepare(`
WITH base AS (
  SELECT
    COALESCE(model_version, 'unknown') AS modelVersion,
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
    modelVersion,
    decision,
    COUNT(*) AS n,
    SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END) AS settled,
    SUM(CASE WHEN selection = result AND returned = 0 THEN 1 ELSE 0 END) AS hits,
    AVG(estimated_hit_rate) AS avgEstimatedHitRate,
    AVG(current_odds) AS avgCurrentOdds,
    SUM(payout_odds) AS totalPayoutOdds,
    MAX(payout_odds) AS maxPayoutOdds
  FROM base
  GROUP BY modelVersion, decision
)
SELECT
  modelVersion,
  decision,
  n,
  settled,
  hits,
  ROUND(hits * 1.0 / NULLIF(settled, 0), 4) AS hitRate,
  ROUND(avgEstimatedHitRate, 4) AS avgEstimatedHitRate,
  ROUND(avgCurrentOdds, 2) AS avgCurrentOdds,
  ROUND(totalPayoutOdds * 1.0 / NULLIF(settled, 0), 3) AS roi,
  ROUND((totalPayoutOdds - maxPayoutOdds) * 1.0 / NULLIF(settled - CASE WHEN maxPayoutOdds > 0 THEN 1 ELSE 0 END, 0), 3) AS roiExMax,
  ROUND(maxPayoutOdds, 2) AS maxPayoutOdds
FROM grouped
WHERE settled >= ?
ORDER BY modelVersion ASC, CASE decision WHEN 'BUY' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'SKIP' THEN 3 ELSE 4 END
`).all(...params) as Row[];
}

function printRows(rows: Row[]) {
  console.log("=== model version simple report ===");
  console.log(`filters: from=${args.from ?? "-"} to=${args.to ?? "-"} venue=${args.venue ?? "-"} decision=${args.decision ?? "-"} minSettled=${args.minSettled}`);
  console.log("");
  console.log("model            decision  n      settled  hits   hitRate  estAvg  oddsAvg  roi     exMax   maxOdds");
  for (const row of rows) {
    console.log([
      row.modelVersion.padEnd(16),
      row.decision.padEnd(8),
      String(row.n).padStart(6),
      String(row.settled).padStart(7),
      String(row.hits).padStart(5),
      fmt(row.hitRate).padStart(7),
      fmt(row.avgEstimatedHitRate).padStart(7),
      fmt(row.avgCurrentOdds).padStart(7),
      fmt(row.roi).padStart(7),
      fmt(row.roiExMax).padStart(7),
      fmt(row.maxPayoutOdds).padStart(7),
    ].join("  "));
  }
}

function fmt(value: number | null) {
  return value == null ? "-" : value.toFixed(3);
}

function parseArgs(argv: string[]) {
  const parsed = { from: null as string | null, to: null as string | null, venue: null as string | null, decision: null as string | null, runKind: null as string | null, minSettled: 10, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--from") { parsed.from = normalizeDate(value); i += 1; }
    else if (key === "--to") { parsed.to = normalizeDate(value); i += 1; }
    else if (key === "--venue") { parsed.venue = String(value ?? ""); i += 1; }
    else if (key === "--decision") { parsed.decision = String(value ?? "").toUpperCase(); i += 1; }
    else if (key === "--run-kind") { parsed.runKind = String(value ?? ""); i += 1; }
    else if (key === "--min-settled") { parsed.minSettled = Math.max(1, Number(value)); i += 1; }
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
  pnpm exec tsx scripts/report-model-version-simple.ts -- --from YYYY-MM-DD --to YYYY-MM-DD [--decision BUY] [--venue 蒲郡] [--min-settled 10] [--json]`);
}

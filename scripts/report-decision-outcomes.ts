/**
 * decision_history の decision 別結果比較レポート。
 *
 * 読み取り専用。外部アクセスなし。
 *
 * 見ること:
 * - BUY / WATCH / SKIP が実際どうだったか
 * - WATCH で当たっていたもの、SKIP で来ていたものを検証する
 * - ROI と ROI excluding max payout を併記する
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error(`[report-decision-outcomes] DB not found: ${DB_PATH}`);
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
  avgEv: number | null;
};

function queryRows(): ReportRow[] {
  const where: string[] = ["1=1"];
  const params: Array<string | number> = [];

  if (args.from) { where.push("date >= ?"); params.push(args.from); }
  if (args.to) { where.push("date <= ?"); params.push(args.to); }
  if (args.venue) { where.push("venue = ?"); params.push(args.venue); }
  if (args.modelVersion) { where.push("model_version = ?"); params.push(args.modelVersion); }
  if (args.runKind) { where.push("run_kind = ?"); params.push(args.runKind); }

  const sql = `
WITH base AS (
  SELECT
    decision,
    selection,
    result,
    returned,
    estimated_hit_rate,
    current_odds,
    ev,
    CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END AS payout_odds
  FROM decision_history
  WHERE ${where.join(" AND ")}
), grouped AS (
  SELECT
    decision,
    COUNT(*) AS n,
    SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END) AS settled,
    SUM(CASE WHEN selection = result AND returned = 0 THEN 1 ELSE 0 END) AS hits,
    AVG(estimated_hit_rate) AS avg_estimated_hit_rate,
    AVG(current_odds) AS avg_current_odds,
    AVG(ev) AS avg_ev,
    SUM(payout_odds) AS total_payout_odds,
    MAX(payout_odds) AS max_payout_odds
  FROM base
  GROUP BY decision
)
SELECT
  decision,
  n,
  settled,
  hits,
  ROUND(hits * 1.0 / NULLIF(settled, 0), 4) AS hitRate,
  ROUND(avg_estimated_hit_rate, 4) AS avgEstimatedHitRate,
  ROUND(avg_current_odds, 2) AS avgCurrentOdds,
  ROUND(total_payout_odds * 1.0 / NULLIF(settled, 0), 3) AS roi,
  ROUND((total_payout_odds - max_payout_odds) * 1.0 / NULLIF(settled - CASE WHEN max_payout_odds > 0 THEN 1 ELSE 0 END, 0), 3) AS roiExMax,
  ROUND(max_payout_odds, 2) AS maxPayoutOdds,
  ROUND(avg_ev, 3) AS avgEv
FROM grouped
ORDER BY CASE decision
  WHEN 'BUY' THEN 1
  WHEN 'WATCH' THEN 2
  WHEN 'SKIP' THEN 3
  ELSE 4
END
`;

  return db.prepare(sql).all(...params) as ReportRow[];
}

function printRows(rows: ReportRow[]) {
  console.log("=== decision outcomes report ===");
  console.log(`generated: ${new Date().toISOString()}`);
  console.log(`filters: from=${args.from ?? "-"} to=${args.to ?? "-"} venue=${args.venue ?? "-"} model=${args.modelVersion ?? "-"} runKind=${args.runKind ?? "-"}`);
  console.log("");
  console.log("decision  n      settled  hits   hitRate  estAvg  oddsAvg  avgEv   roi     roiExMax  maxOdds");
  for (const row of rows) {
    console.log([
      row.decision.padEnd(8),
      String(row.n).padStart(6),
      String(row.settled).padStart(7),
      String(row.hits).padStart(5),
      format(row.hitRate).padStart(7),
      format(row.avgEstimatedHitRate).padStart(7),
      format(row.avgCurrentOdds).padStart(7),
      format(row.avgEv).padStart(7),
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
    venue: null as string | null,
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
  pnpm exec tsx scripts/report-decision-outcomes.ts -- --from YYYY-MM-DD --to YYYY-MM-DD [--venue 蒲郡] [--model-version X] [--run-kind paper-live] [--json]

Read-only. No external access.`);
}

/**
 * 人気順位の時系列変化を見る read-only レポート。
 *
 * 目的:
 * - オッズ倍率だけでなく、市場人気が締切前に良化/悪化したかを見る
 * - WATCH/SKIPに落としたものが市場で買われていたか確認する
 * - BUYが締切前に市場から嫌われていないか確認する
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
  console.error(`[report-popularity-movement] DB not found: ${DB_PATH}`);
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
  movement: string;
  decision: string;
  n: number;
  settled: number;
  hits: number;
  hitRate: number | null;
  avgT30Popularity: number | null;
  avgT5Popularity: number | null;
  avgPopularityDelta: number | null;
  avgT30Odds: number | null;
  avgT5Odds: number | null;
  roi: number | null;
  roiExMax: number | null;
};

function queryRows(): ReportRow[] {
  const where: string[] = ["1=1"];
  const params: Array<string | number> = [];

  if (args.from) { where.push("dh.date >= ?"); params.push(args.from); }
  if (args.to) { where.push("dh.date <= ?"); params.push(args.to); }
  if (args.venue) { where.push("dh.venue = ?"); params.push(args.venue); }
  if (args.decision) { where.push("dh.decision = ?"); params.push(args.decision); }
  if (args.modelVersion) { where.push("dh.model_version = ?"); params.push(args.modelVersion); }
  if (args.runKind) { where.push("dh.run_kind = ?"); params.push(args.runKind); }

  const sql = `
WITH ranked AS (
  SELECT
    race_id,
    selection,
    checkpoint_label,
    odds,
    popularity,
    ROW_NUMBER() OVER (
      PARTITION BY race_id, selection, checkpoint_label
      ORDER BY captured_at DESC
    ) AS rn
  FROM odds_timeseries_snapshots
  WHERE checkpoint_label IN ('T-30', 'T-5')
), pivoted AS (
  SELECT
    race_id,
    selection,
    MAX(CASE WHEN checkpoint_label = 'T-30' THEN popularity END) AS t30_popularity,
    MAX(CASE WHEN checkpoint_label = 'T-5' THEN popularity END) AS t5_popularity,
    MAX(CASE WHEN checkpoint_label = 'T-30' THEN odds END) AS t30_odds,
    MAX(CASE WHEN checkpoint_label = 'T-5' THEN odds END) AS t5_odds
  FROM ranked
  WHERE rn = 1
  GROUP BY race_id, selection
), joined AS (
  SELECT
    dh.decision,
    dh.selection,
    dh.result,
    dh.returned,
    dh.current_odds,
    p.t30_popularity,
    p.t5_popularity,
    p.t30_odds,
    p.t5_odds,
    CASE
      WHEN p.t30_popularity IS NULL OR p.t5_popularity IS NULL THEN 'unknown'
      WHEN p.t5_popularity <= p.t30_popularity - 10 THEN 'improved-10+'
      WHEN p.t5_popularity <= p.t30_popularity - 3 THEN 'improved-3-9'
      WHEN p.t5_popularity >= p.t30_popularity + 10 THEN 'worsened-10+'
      WHEN p.t5_popularity >= p.t30_popularity + 3 THEN 'worsened-3-9'
      ELSE 'flat'
    END AS movement,
    CASE
      WHEN p.t30_popularity IS NOT NULL AND p.t5_popularity IS NOT NULL THEN p.t5_popularity - p.t30_popularity
      ELSE NULL
    END AS popularity_delta,
    CASE WHEN dh.selection = dh.result AND dh.returned = 0 THEN dh.current_odds ELSE 0 END AS payout_odds
  FROM decision_history dh
  LEFT JOIN pivoted p
    ON p.race_id = dh.race_id
   AND p.selection = dh.selection
  WHERE ${where.join(" AND ")}
), grouped AS (
  SELECT
    movement,
    decision,
    COUNT(*) AS n,
    SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END) AS settled,
    SUM(CASE WHEN selection = result AND returned = 0 THEN 1 ELSE 0 END) AS hits,
    AVG(t30_popularity) AS avg_t30_popularity,
    AVG(t5_popularity) AS avg_t5_popularity,
    AVG(popularity_delta) AS avg_popularity_delta,
    AVG(t30_odds) AS avg_t30_odds,
    AVG(t5_odds) AS avg_t5_odds,
    SUM(payout_odds) AS total_payout_odds,
    MAX(payout_odds) AS max_payout_odds
  FROM joined
  GROUP BY movement, decision
)
SELECT
  movement,
  decision,
  n,
  settled,
  hits,
  ROUND(hits * 1.0 / NULLIF(settled, 0), 4) AS hitRate,
  ROUND(avg_t30_popularity, 2) AS avgT30Popularity,
  ROUND(avg_t5_popularity, 2) AS avgT5Popularity,
  ROUND(avg_popularity_delta, 2) AS avgPopularityDelta,
  ROUND(avg_t30_odds, 2) AS avgT30Odds,
  ROUND(avg_t5_odds, 2) AS avgT5Odds,
  ROUND(total_payout_odds * 1.0 / NULLIF(settled, 0), 3) AS roi,
  ROUND((total_payout_odds - max_payout_odds) * 1.0 / NULLIF(settled - CASE WHEN max_payout_odds > 0 THEN 1 ELSE 0 END, 0), 3) AS roiExMax
FROM grouped
ORDER BY CASE movement
  WHEN 'improved-10+' THEN 1
  WHEN 'improved-3-9' THEN 2
  WHEN 'flat' THEN 3
  WHEN 'worsened-3-9' THEN 4
  WHEN 'worsened-10+' THEN 5
  ELSE 6
END,
CASE decision WHEN 'BUY' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'SKIP' THEN 3 ELSE 4 END
`;

  return db.prepare(sql).all(...params) as ReportRow[];
}

function printRows(rows: ReportRow[]) {
  console.log("=== popularity movement report ===");
  console.log(`generated: ${new Date().toISOString()}`);
  console.log(`filters: from=${args.from ?? "-"} to=${args.to ?? "-"} venue=${args.venue ?? "-"} decision=${args.decision ?? "-"} model=${args.modelVersion ?? "-"} runKind=${args.runKind ?? "-"}`);
  console.log("");
  console.log("movement       decision  n      settled  hits   hitRate  T30pop  T5pop   popΔ    T30odds T5odds  roi     roiExMax");
  for (const row of rows) {
    console.log([
      row.movement.padEnd(14),
      row.decision.padEnd(8),
      String(row.n).padStart(6),
      String(row.settled).padStart(7),
      String(row.hits).padStart(5),
      fmt(row.hitRate).padStart(7),
      fmt(row.avgT30Popularity).padStart(7),
      fmt(row.avgT5Popularity).padStart(7),
      fmt(row.avgPopularityDelta).padStart(7),
      fmt(row.avgT30Odds).padStart(7),
      fmt(row.avgT5Odds).padStart(7),
      fmt(row.roi).padStart(7),
      fmt(row.roiExMax).padStart(8),
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
  pnpm exec tsx scripts/report-popularity-movement.ts -- --from YYYY-MM-DD --to YYYY-MM-DD [--venue 蒲郡] [--decision BUY|WATCH|SKIP] [--json]

Read-only. No external access.`);
}

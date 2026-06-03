/**
 * odds_timeseries_snapshots と decision_history を使った CLV 確認レポート。
 *
 * 読み取り専用。外部アクセスなし。
 *
 * 見ること:
 * - decision 別に T-30 / T-20 / T-10 / T-5 の平均オッズ
 * - T-30 から T-5 への変化率
 * - 結果確定済みの hit / ROI(current_odds基準)
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error(`[report-clv] DB not found: ${DB_PATH}`);
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
  roi: number | null;
  avgT30: number | null;
  avgT20: number | null;
  avgT10: number | null;
  avgT5: number | null;
  avgClvDrop: number | null;
};

function queryRows(): ReportRow[] {
  const where: string[] = ["1=1"];
  const params: Array<string | number> = [];

  if (args.from) { where.push("dh.date >= ?"); params.push(args.from); }
  if (args.to) { where.push("dh.date <= ?"); params.push(args.to); }
  if (args.decision) { where.push("dh.decision = ?"); params.push(args.decision); }
  if (args.modelVersion) { where.push("dh.model_version = ?"); params.push(args.modelVersion); }
  if (args.runKind) { where.push("dh.run_kind = ?"); params.push(args.runKind); }

  const sql = `
WITH odds_by_checkpoint AS (
  SELECT
    race_id,
    selection,
    checkpoint_label,
    odds,
    ROW_NUMBER() OVER (
      PARTITION BY race_id, selection, checkpoint_label
      ORDER BY captured_at DESC
    ) AS rn
  FROM odds_timeseries_snapshots
  WHERE checkpoint_label IN ('T-30', 'T-20', 'T-10', 'T-5')
), pivoted AS (
  SELECT
    race_id,
    selection,
    MAX(CASE WHEN checkpoint_label = 'T-30' THEN odds END) AS t30,
    MAX(CASE WHEN checkpoint_label = 'T-20' THEN odds END) AS t20,
    MAX(CASE WHEN checkpoint_label = 'T-10' THEN odds END) AS t10,
    MAX(CASE WHEN checkpoint_label = 'T-5' THEN odds END) AS t5
  FROM odds_by_checkpoint
  WHERE rn = 1
  GROUP BY race_id, selection
), joined AS (
  SELECT
    dh.decision,
    dh.selection,
    dh.result,
    dh.returned,
    dh.current_odds,
    p.t30,
    p.t20,
    p.t10,
    p.t5,
    CASE
      WHEN p.t30 IS NOT NULL AND p.t30 > 0 AND p.t5 IS NOT NULL THEN (p.t30 - p.t5) * 1.0 / p.t30
      ELSE NULL
    END AS clv_drop
  FROM decision_history dh
  LEFT JOIN pivoted p
    ON p.race_id = dh.race_id
   AND p.selection = dh.selection
  WHERE ${where.join(" AND ")}
)
SELECT
  decision,
  COUNT(*) AS n,
  SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END) AS settled,
  SUM(CASE WHEN selection = result AND returned = 0 THEN 1 ELSE 0 END) AS hits,
  ROUND(
    SUM(CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END) * 1.0
    / NULLIF(SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END), 0),
    3
  ) AS roi,
  ROUND(AVG(t30), 2) AS avgT30,
  ROUND(AVG(t20), 2) AS avgT20,
  ROUND(AVG(t10), 2) AS avgT10,
  ROUND(AVG(t5), 2) AS avgT5,
  ROUND(AVG(clv_drop), 4) AS avgClvDrop
FROM joined
GROUP BY decision
ORDER BY decision
`;

  return db.prepare(sql).all(...params) as ReportRow[];
}

function printRows(rows: ReportRow[]) {
  console.log("=== CLV report ===");
  console.log(`generated: ${new Date().toISOString()}`);
  console.log(`filters: from=${args.from ?? "-"} to=${args.to ?? "-"} decision=${args.decision ?? "-"} model=${args.modelVersion ?? "-"} runKind=${args.runKind ?? "-"}`);
  console.log("");
  console.log("decision  n      settled  hits   roi     T-30    T-20    T-10    T-5     clvDrop");
  for (const row of rows) {
    console.log([
      row.decision.padEnd(8),
      String(row.n).padStart(6),
      String(row.settled).padStart(7),
      String(row.hits).padStart(5),
      format(row.roi).padStart(7),
      format(row.avgT30).padStart(7),
      format(row.avgT20).padStart(7),
      format(row.avgT10).padStart(7),
      format(row.avgT5).padStart(7),
      format(row.avgClvDrop).padStart(8),
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
  pnpm exec tsx scripts/report-clv.ts -- --from YYYY-MM-DD --to YYYY-MM-DD [--decision BUY|WATCH|SKIP] [--model-version X] [--run-kind paper-live] [--json]

Read-only. No external access.`);
}

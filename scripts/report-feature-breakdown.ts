/**
 * feature_adjustment_breakdown の読み取り専用レポート。
 * 外部アクセスなし。DB内容を集計して、補正値の分布と結果を確認する。
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const FACTORS = [
  "total",
  "classFactor",
  "nationalFactor",
  "localFactor",
  "motorFactor",
  "boatFactor",
  "courseStFactor",
  "courseTop3Factor",
  "exhibitionResidualFactor",
  "secondClassFactor",
  "secondLocalFactor",
  "thirdClassFactor",
] as const;
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error(`[report-feature-breakdown] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

try {
  if (!columnExists("feature_adjustment_breakdown")) {
    console.error("[report-feature-breakdown] feature_adjustment_breakdown column is missing. Run: pnpm migrate:decision-audit");
    process.exit(1);
  }

  const rows = FACTORS.flatMap((factor) => queryFactor(factor));
  if (args.json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), args, rows }, null, 2));
  } else {
    printRows(rows);
  }
} finally {
  db.close();
}

type ReportRow = {
  factor: string;
  band: string;
  n: number;
  settled: number;
  hits: number;
  roi: number | null;
  avgValue: number | null;
};

function queryFactor(factor: string): ReportRow[] {
  const where: string[] = ["feature_adjustment_breakdown IS NOT NULL", "json_valid(feature_adjustment_breakdown)"];
  const params: Array<string | number> = [];

  if (args.from) { where.push("date >= ?"); params.push(args.from); }
  if (args.to) { where.push("date <= ?"); params.push(args.to); }
  if (args.decision) { where.push("decision = ?"); params.push(args.decision); }
  if (args.modelVersion) { where.push("model_version = ?"); params.push(args.modelVersion); }
  if (args.runKind) { where.push("run_kind = ?"); params.push(args.runKind); }

  const sql = `
WITH base AS (
  SELECT
    selection,
    result,
    returned,
    current_odds,
    CAST(json_extract(feature_adjustment_breakdown, ?) AS REAL) AS value
  FROM decision_history
  WHERE ${where.join(" AND ")}
), banded AS (
  SELECT
    CASE
      WHEN value IS NULL THEN 'missing'
      WHEN value < 0.97 THEN '<0.97'
      WHEN value < 1.00 THEN '0.97-1.00'
      WHEN value < 1.03 THEN '1.00-1.03'
      WHEN value < 1.06 THEN '1.03-1.06'
      ELSE '1.06+'
    END AS band,
    selection,
    result,
    returned,
    current_odds,
    value
  FROM base
)
SELECT
  ? AS factor,
  band,
  COUNT(*) AS n,
  SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END) AS settled,
  SUM(CASE WHEN selection = result AND returned = 0 THEN 1 ELSE 0 END) AS hits,
  ROUND(
    SUM(CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END) * 1.0
    / NULLIF(SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END), 0),
    3
  ) AS roi,
  ROUND(AVG(value), 4) AS avgValue
FROM banded
GROUP BY band
ORDER BY factor, band
`;

  return db.prepare(sql).all(`$.${factor}`, ...params, factor) as ReportRow[];
}

function printRows(rows: ReportRow[]) {
  console.log("=== feature breakdown report ===");
  console.log(`generated: ${new Date().toISOString()}`);
  console.log(`filters: from=${args.from ?? "-"} to=${args.to ?? "-"} decision=${args.decision ?? "-"} model=${args.modelVersion ?? "-"} runKind=${args.runKind ?? "-"}`);
  console.log("");
  console.log("factor                       band        n      settled  hits   roi     avgValue");
  for (const row of rows) {
    console.log([
      row.factor.padEnd(28),
      row.band.padEnd(10),
      String(row.n).padStart(6),
      String(row.settled).padStart(7),
      String(row.hits).padStart(5),
      format(row.roi).padStart(7),
      format(row.avgValue).padStart(8),
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
  pnpm report:feature-breakdown -- --from YYYY-MM-DD --to YYYY-MM-DD [--decision BUY|WATCH|SKIP] [--model-version X] [--run-kind paper-live] [--json]

Read-only. No external access.`);
}

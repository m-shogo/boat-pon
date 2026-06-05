/**
 * decision_history からルール見直し候補を出す read-only レポート。
 *
 * 目的:
 * - BUYで成績が悪い帯を「厳しくする候補」として出す
 * - WATCH/SKIPで成績が良い帯を「緩める候補」として出す
 * - 最終判断は人間が行う。自動でルール変更しない。
 *
 * 注意:
 * - 読み取り専用
 * - 外部アクセスなし
 * - 自動投票・購入操作なし
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error(`[report-rule-candidates] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

try {
  const rows = [
    ...queryMetric("current_odds", oddsBandSql("current_odds")),
    ...queryMetric("required_odds", oddsBandSql("required_odds")),
    ...queryMetric("odds_ratio", oddsRatioBandSql()),
    ...queryMetric("sample_size", sampleBandSql()),
    ...queryMetric("environment", environmentBandSql()),
  ].filter((row) => row.settled >= args.minSettled)
   .map(addSuggestion)
   .filter((row) => row.suggestion !== "keep-observing");

  if (args.json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), args, rows }, null, 2));
  } else {
    printRows(rows);
  }
} finally {
  db.close();
}

type BaseRow = {
  metric: string;
  band: string;
  decision: string;
  n: number;
  settled: number;
  hits: number;
  hitRate: number | null;
  avgEstimatedHitRate: number | null;
  avgCurrentOdds: number | null;
  roi: number | null;
  roiExMax: number | null;
};

type SuggestionRow = BaseRow & {
  suggestion: "tighten-buy" | "review-watch-skip" | "keep-observing";
  reason: string;
};

function queryMetric(metric: string, bandExpr: string): BaseRow[] {
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
  ROUND(hits * 1.0 / NULLIF(settled, 0), 4) AS hitRate,
  ROUND(avg_estimated_hit_rate, 4) AS avgEstimatedHitRate,
  ROUND(avg_current_odds, 2) AS avgCurrentOdds,
  ROUND(total_payout_odds * 1.0 / NULLIF(settled, 0), 3) AS roi,
  ROUND((total_payout_odds - max_payout_odds) * 1.0 / NULLIF(settled - CASE WHEN max_payout_odds > 0 THEN 1 ELSE 0 END, 0), 3) AS roiExMax
FROM grouped
ORDER BY metric, band, decision
`;

  return db.prepare(sql).all(...params, metric) as BaseRow[];
}

function addSuggestion(row: BaseRow): SuggestionRow {
  const roi = row.roi ?? 0;
  const roiExMax = row.roiExMax ?? 0;

  if (row.decision === "BUY" && roi < args.badRoi && roiExMax < args.badRoiExMax) {
    return {
      ...row,
      suggestion: "tighten-buy",
      reason: `BUY underperformed: roi=${fmt(roi)}, roiExMax=${fmt(roiExMax)}`,
    };
  }

  if ((row.decision === "WATCH" || row.decision === "SKIP") && roi >= args.goodRoi && roiExMax >= args.goodRoiExMax) {
    return {
      ...row,
      suggestion: "review-watch-skip",
      reason: `${row.decision} performed well: roi=${fmt(roi)}, roiExMax=${fmt(roiExMax)}`,
    };
  }

  return {
    ...row,
    suggestion: "keep-observing",
    reason: "not enough signal",
  };
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

function oddsRatioBandSql() {
  return `CASE
    WHEN current_odds IS NULL OR required_odds IS NULL OR required_odds <= 0 THEN 'missing'
    WHEN current_odds / required_odds < 1 THEN '<1.0'
    WHEN current_odds / required_odds < 1.25 THEN '1.00-1.25'
    WHEN current_odds / required_odds < 1.50 THEN '1.25-1.50'
    WHEN current_odds / required_odds < 2.00 THEN '1.50-2.00'
    ELSE '2.00+'
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

function environmentBandSql() {
  if (!columnExists("environment_risk_level")) return "'unknown-column'";
  return `CASE
    WHEN environment_risk_level IS NULL OR environment_risk_level = '' THEN 'unknown'
    ELSE environment_risk_level
  END`;
}

function printRows(rows: SuggestionRow[]) {
  console.log("=== rule candidates report ===");
  console.log(`generated: ${new Date().toISOString()}`);
  console.log(`filters: from=${args.from ?? "-"} to=${args.to ?? "-"} venue=${args.venue ?? "-"} model=${args.modelVersion ?? "-"} runKind=${args.runKind ?? "-"}`);
  console.log(`thresholds: minSettled=${args.minSettled} badRoi=${args.badRoi} badRoiExMax=${args.badRoiExMax} goodRoi=${args.goodRoi} goodRoiExMax=${args.goodRoiExMax}`);
  console.log("");
  console.log("suggestion        metric         band        decision  n      settled  hits   hitRate  roi     roiExMax  reason");
  for (const row of rows) {
    console.log([
      row.suggestion.padEnd(17),
      row.metric.padEnd(13),
      row.band.padEnd(10),
      row.decision.padEnd(8),
      String(row.n).padStart(6),
      String(row.settled).padStart(7),
      String(row.hits).padStart(5),
      fmt(row.hitRate).padStart(7),
      fmt(row.roi).padStart(7),
      fmt(row.roiExMax).padStart(8),
      row.reason,
    ].join("  "));
  }
}

function columnExists(column: string): boolean {
  const rows = db.prepare("PRAGMA table_info(decision_history)").all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function fmt(value: number | null) {
  return value == null ? "-" : value.toFixed(3);
}

function parseArgs(argv: string[]) {
  const parsed = {
    from: null as string | null,
    to: null as string | null,
    venue: null as string | null,
    modelVersion: null as string | null,
    runKind: null as string | null,
    minSettled: 30,
    badRoi: 0.8,
    badRoiExMax: 0.8,
    goodRoi: 1.1,
    goodRoiExMax: 1.0,
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
    else if (key === "--min-settled") { parsed.minSettled = Math.max(1, Number(value)); i += 1; }
    else if (key === "--bad-roi") { parsed.badRoi = Number(value); i += 1; }
    else if (key === "--bad-roi-ex-max") { parsed.badRoiExMax = Number(value); i += 1; }
    else if (key === "--good-roi") { parsed.goodRoi = Number(value); i += 1; }
    else if (key === "--good-roi-ex-max") { parsed.goodRoiExMax = Number(value); i += 1; }
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
  pnpm exec tsx scripts/report-rule-candidates.ts -- --from YYYY-MM-DD --to YYYY-MM-DD [--venue 蒲郡] [--min-settled 30] [--json]

Read-only. No external access. Suggestions are for review only.`);
}

/**
 * 時系列分割でルール候補の安定性を見る read-only レポート。
 *
 * 目的:
 * - 前半で良かった/悪かった条件が、後半でも同じ傾向か確認する
 * - rule-candidates の過学習を避ける
 * - 自動でルール変更しない。人間レビュー用。
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
  console.error(`[report-time-split-stability] DB not found: ${DB_PATH}`);
  process.exit(1);
}

if (!args.splitDate) {
  console.error("[report-time-split-stability] --split-date is required");
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

try {
  const before = queryPeriod("before", args.from, previousDate(args.splitDate));
  const after = queryPeriod("after", args.splitDate, args.to);
  const rows = mergeRows(before, after).filter((row) => row.beforeSettled >= args.minSettled || row.afterSettled >= args.minSettled);

  if (args.json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), args, rows }, null, 2));
  } else {
    printRows(rows);
  }
} finally {
  db.close();
}

type PeriodRow = {
  period: "before" | "after";
  metric: string;
  band: string;
  decision: string;
  n: number;
  settled: number;
  hits: number;
  roi: number | null;
  roiExMax: number | null;
};

type StabilityRow = {
  metric: string;
  band: string;
  decision: string;
  beforeSettled: number;
  beforeHits: number;
  beforeRoi: number | null;
  beforeRoiExMax: number | null;
  afterSettled: number;
  afterHits: number;
  afterRoi: number | null;
  afterRoiExMax: number | null;
  stability: "stable-good" | "stable-bad" | "reversed" | "insufficient" | "mixed";
};

function queryPeriod(period: "before" | "after", from: string | null, to: string | null): PeriodRow[] {
  return [
    ...queryMetric(period, "current_odds", oddsBandSql("current_odds"), from, to),
    ...queryMetric(period, "required_odds", oddsBandSql("required_odds"), from, to),
    ...queryMetric(period, "odds_ratio", oddsRatioBandSql(), from, to),
    ...queryMetric(period, "sample_size", sampleBandSql(), from, to),
    ...queryMetric(period, "environment", environmentBandSql(), from, to),
  ];
}

function queryMetric(period: "before" | "after", metric: string, bandExpr: string, from: string | null, to: string | null): PeriodRow[] {
  const where: string[] = ["1=1"];
  const params: Array<string | number> = [];
  if (from) { where.push("date >= ?"); params.push(from); }
  if (to) { where.push("date <= ?"); params.push(to); }
  if (args.venue) { where.push("venue = ?"); params.push(args.venue); }
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
    MAX(payout_odds) AS max_payout_odds
  FROM base
  GROUP BY band, decision
)
SELECT
  ? AS period,
  ? AS metric,
  band,
  decision,
  n,
  settled,
  hits,
  ROUND(total_payout_odds * 1.0 / NULLIF(settled, 0), 3) AS roi,
  ROUND((total_payout_odds - max_payout_odds) * 1.0 / NULLIF(settled - CASE WHEN max_payout_odds > 0 THEN 1 ELSE 0 END, 0), 3) AS roiExMax
FROM grouped
`;
  return db.prepare(sql).all(...params, period, metric) as PeriodRow[];
}

function mergeRows(before: PeriodRow[], after: PeriodRow[]): StabilityRow[] {
  const map = new Map<string, StabilityRow>();
  for (const row of before) {
    const key = makeKey(row);
    map.set(key, {
      metric: row.metric,
      band: row.band,
      decision: row.decision,
      beforeSettled: row.settled,
      beforeHits: row.hits,
      beforeRoi: row.roi,
      beforeRoiExMax: row.roiExMax,
      afterSettled: 0,
      afterHits: 0,
      afterRoi: null,
      afterRoiExMax: null,
      stability: "insufficient",
    });
  }
  for (const row of after) {
    const key = makeKey(row);
    const existing = map.get(key) ?? {
      metric: row.metric,
      band: row.band,
      decision: row.decision,
      beforeSettled: 0,
      beforeHits: 0,
      beforeRoi: null,
      beforeRoiExMax: null,
      afterSettled: 0,
      afterHits: 0,
      afterRoi: null,
      afterRoiExMax: null,
      stability: "insufficient" as const,
    };
    existing.afterSettled = row.settled;
    existing.afterHits = row.hits;
    existing.afterRoi = row.roi;
    existing.afterRoiExMax = row.roiExMax;
    map.set(key, existing);
  }

  return [...map.values()].map((row) => ({ ...row, stability: classify(row) }))
    .sort((a, b) => a.metric.localeCompare(b.metric) || a.band.localeCompare(b.band) || a.decision.localeCompare(b.decision));
}

function makeKey(row: Pick<PeriodRow, "metric" | "band" | "decision">) {
  return `${row.metric}\t${row.band}\t${row.decision}`;
}

function classify(row: StabilityRow): StabilityRow["stability"] {
  if (row.beforeSettled < args.minSettled || row.afterSettled < args.minSettled) return "insufficient";
  const beforeGood = (row.beforeRoi ?? 0) >= args.goodRoi && (row.beforeRoiExMax ?? 0) >= args.goodRoiExMax;
  const afterGood = (row.afterRoi ?? 0) >= args.goodRoi && (row.afterRoiExMax ?? 0) >= args.goodRoiExMax;
  const beforeBad = (row.beforeRoi ?? 0) <= args.badRoi && (row.beforeRoiExMax ?? 0) <= args.badRoiExMax;
  const afterBad = (row.afterRoi ?? 0) <= args.badRoi && (row.afterRoiExMax ?? 0) <= args.badRoiExMax;
  if (beforeGood && afterGood) return "stable-good";
  if (beforeBad && afterBad) return "stable-bad";
  if ((beforeGood && afterBad) || (beforeBad && afterGood)) return "reversed";
  return "mixed";
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

function columnExists(column: string): boolean {
  const rows = db.prepare("PRAGMA table_info(decision_history)").all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function printRows(rows: StabilityRow[]) {
  console.log("=== time split stability report ===");
  console.log(`generated: ${new Date().toISOString()}`);
  console.log(`filters: from=${args.from ?? "-"} split=${args.splitDate} to=${args.to ?? "-"} venue=${args.venue ?? "-"} decision=${args.decision ?? "-"}`);
  console.log(`thresholds: minSettled=${args.minSettled} good=${args.goodRoi}/${args.goodRoiExMax} bad=${args.badRoi}/${args.badRoiExMax}`);
  console.log("");
  console.log("stability      metric         band        decision  beforeN  beforeROI exMax    afterN   afterROI  exMax");
  for (const row of rows) {
    console.log([
      row.stability.padEnd(14),
      row.metric.padEnd(13),
      row.band.padEnd(10),
      row.decision.padEnd(8),
      String(row.beforeSettled).padStart(7),
      fmt(row.beforeRoi).padStart(9),
      fmt(row.beforeRoiExMax).padStart(7),
      String(row.afterSettled).padStart(7),
      fmt(row.afterRoi).padStart(9),
      fmt(row.afterRoiExMax).padStart(7),
    ].join("  "));
  }
}

function fmt(value: number | null) {
  return value == null ? "-" : value.toFixed(3);
}

function previousDate(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function parseArgs(argv: string[]) {
  const parsed = {
    from: null as string | null,
    splitDate: null as string | null,
    to: null as string | null,
    venue: null as string | null,
    decision: null as string | null,
    modelVersion: null as string | null,
    runKind: null as string | null,
    minSettled: 30,
    goodRoi: 1.1,
    goodRoiExMax: 1.0,
    badRoi: 0.8,
    badRoiExMax: 0.8,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--from") { parsed.from = normalizeDate(value); i += 1; }
    else if (key === "--split-date") { parsed.splitDate = normalizeDate(value); i += 1; }
    else if (key === "--to") { parsed.to = normalizeDate(value); i += 1; }
    else if (key === "--venue") { parsed.venue = String(value ?? ""); i += 1; }
    else if (key === "--decision") { parsed.decision = String(value ?? "").toUpperCase(); i += 1; }
    else if (key === "--model-version") { parsed.modelVersion = String(value ?? ""); i += 1; }
    else if (key === "--run-kind") { parsed.runKind = String(value ?? ""); i += 1; }
    else if (key === "--min-settled") { parsed.minSettled = Math.max(1, Number(value)); i += 1; }
    else if (key === "--good-roi") { parsed.goodRoi = Number(value); i += 1; }
    else if (key === "--good-roi-ex-max") { parsed.goodRoiExMax = Number(value); i += 1; }
    else if (key === "--bad-roi") { parsed.badRoi = Number(value); i += 1; }
    else if (key === "--bad-roi-ex-max") { parsed.badRoiExMax = Number(value); i += 1; }
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
  pnpm exec tsx scripts/report-time-split-stability.ts -- --from YYYY-MM-DD --split-date YYYY-MM-DD --to YYYY-MM-DD [--decision BUY] [--min-settled 30] [--json]

Read-only. No external access.`);
}

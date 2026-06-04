/**
 * boat-pon の期間レビューを一発で見る read-only サマリー。
 *
 * 目的:
 * - レポートが増えてきたので、最初に見るべき要約を出す
 * - BUY 外れ / WATCH-SKIP 的中 / decision別成績 / audit充足をまとめる
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
  console.error(`[report-review-summary] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

try {
  const summary = {
    generatedAt: new Date().toISOString(),
    filters: args,
    totals: queryTotals(),
    byDecision: queryByDecision(),
    auditCoverage: queryAuditCoverage(),
    topBuyMisses: queryTopRows("buy-misses"),
    topMissedHits: queryTopRows("missed-hits"),
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printSummary(summary);
  }
} finally {
  db.close();
}

type TotalRow = {
  decisions: number;
  settled: number;
  buy: number;
  watch: number;
  skip: number;
  buyMisses: number;
  missedHits: number;
};

type DecisionRow = {
  decision: string;
  n: number;
  settled: number;
  hits: number;
  hitRate: number | null;
  roi: number | null;
  roiExMax: number | null;
  maxPayoutOdds: number | null;
};

type AuditCoverageRow = {
  rows: number;
  reasonRows: number;
  reasonCoverage: number | null;
  featureRows: number;
  featureCoverage: number | null;
};

type DetailRow = {
  date: string;
  venue: string;
  raceNo: number;
  decision: string;
  selection: string;
  result: string | null;
  currentOdds: number | null;
  ev: number | null;
  estimatedHitRate: number | null;
};

function queryTotals(): TotalRow {
  const where = makeWhere("", []);
  return db.prepare(`
SELECT
  COUNT(*) AS decisions,
  SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END) AS settled,
  SUM(CASE WHEN decision = 'BUY' THEN 1 ELSE 0 END) AS buy,
  SUM(CASE WHEN decision = 'WATCH' THEN 1 ELSE 0 END) AS watch,
  SUM(CASE WHEN decision = 'SKIP' THEN 1 ELSE 0 END) AS skip,
  SUM(CASE WHEN decision = 'BUY' AND returned = 0 AND (result IS NULL OR selection != result) THEN 1 ELSE 0 END) AS buyMisses,
  SUM(CASE WHEN decision IN ('WATCH', 'SKIP') AND returned = 0 AND selection = result THEN 1 ELSE 0 END) AS missedHits
FROM decision_history
WHERE ${where.sql}
`).get(...where.params) as TotalRow;
}

function queryByDecision(): DecisionRow[] {
  const where = makeWhere("", []);
  return db.prepare(`
WITH base AS (
  SELECT
    decision,
    selection,
    result,
    returned,
    current_odds,
    CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END AS payout_odds
  FROM decision_history
  WHERE ${where.sql}
), grouped AS (
  SELECT
    decision,
    COUNT(*) AS n,
    SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END) AS settled,
    SUM(CASE WHEN selection = result AND returned = 0 THEN 1 ELSE 0 END) AS hits,
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
  ROUND(total_payout_odds * 1.0 / NULLIF(settled, 0), 3) AS roi,
  ROUND((total_payout_odds - max_payout_odds) * 1.0 / NULLIF(settled - CASE WHEN max_payout_odds > 0 THEN 1 ELSE 0 END, 0), 3) AS roiExMax,
  ROUND(max_payout_odds, 2) AS maxPayoutOdds
FROM grouped
ORDER BY CASE decision WHEN 'BUY' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'SKIP' THEN 3 ELSE 4 END
`).all(...where.params) as DecisionRow[];
}

function queryAuditCoverage(): AuditCoverageRow {
  const hasReasons = columnExists("decision_reasons");
  const hasFeatures = columnExists("feature_adjustment_breakdown");
  const reasonExpr = hasReasons ? "SUM(CASE WHEN decision_reasons IS NOT NULL AND decision_reasons != '[]' THEN 1 ELSE 0 END)" : "0";
  const featureExpr = hasFeatures ? "SUM(CASE WHEN feature_adjustment_breakdown IS NOT NULL THEN 1 ELSE 0 END)" : "0";
  const where = makeWhere("", []);

  return db.prepare(`
SELECT
  COUNT(*) AS rows,
  ${reasonExpr} AS reasonRows,
  ROUND(${reasonExpr} * 1.0 / NULLIF(COUNT(*), 0), 4) AS reasonCoverage,
  ${featureExpr} AS featureRows,
  ROUND(${featureExpr} * 1.0 / NULLIF(COUNT(*), 0), 4) AS featureCoverage
FROM decision_history
WHERE ${where.sql}
`).get(...where.params) as AuditCoverageRow;
}

function queryTopRows(kind: "buy-misses" | "missed-hits"): DetailRow[] {
  const extra = kind === "buy-misses"
    ? "decision = 'BUY' AND returned = 0 AND (result IS NULL OR selection != result)"
    : "decision IN ('WATCH', 'SKIP') AND returned = 0 AND selection = result";
  const where = makeWhere(extra, []);

  return db.prepare(`
SELECT
  date,
  venue,
  race_no AS raceNo,
  decision,
  selection,
  result,
  current_odds AS currentOdds,
  ev,
  estimated_hit_rate AS estimatedHitRate
FROM decision_history
WHERE ${where.sql}
ORDER BY current_odds DESC, ev DESC, date DESC
LIMIT ?
`).all(...where.params, args.limit) as DetailRow[];
}

function makeWhere(extra: string, params: Array<string | number>) {
  const where = ["1=1"];
  if (args.from) { where.push("date >= ?"); params.push(args.from); }
  if (args.to) { where.push("date <= ?"); params.push(args.to); }
  if (args.venue) { where.push("venue = ?"); params.push(args.venue); }
  if (args.modelVersion) { where.push("model_version = ?"); params.push(args.modelVersion); }
  if (args.runKind) { where.push("run_kind = ?"); params.push(args.runKind); }
  if (extra) where.push(`(${extra})`);
  return { sql: where.join(" AND "), params };
}

function printSummary(summary: {
  generatedAt: string;
  filters: typeof args;
  totals: TotalRow;
  byDecision: DecisionRow[];
  auditCoverage: AuditCoverageRow;
  topBuyMisses: DetailRow[];
  topMissedHits: DetailRow[];
}) {
  console.log("=== boat-pon review summary ===");
  console.log(`generated: ${summary.generatedAt}`);
  console.log(`filters: from=${args.from ?? "-"} to=${args.to ?? "-"} venue=${args.venue ?? "-"} model=${args.modelVersion ?? "-"} runKind=${args.runKind ?? "-"}`);
  console.log("");
  console.log(`decisions=${summary.totals.decisions} settled=${summary.totals.settled} BUY=${summary.totals.buy} WATCH=${summary.totals.watch} SKIP=${summary.totals.skip}`);
  console.log(`buyMisses=${summary.totals.buyMisses} missedHits(WATCH/SKIP)=${summary.totals.missedHits}`);
  console.log(`auditCoverage reasons=${pct(summary.auditCoverage.reasonCoverage)} features=${pct(summary.auditCoverage.featureCoverage)}`);
  console.log("");
  console.log("decision outcomes");
  console.log("decision  n      settled  hits   hitRate  roi     roiExMax  maxOdds");
  for (const row of summary.byDecision) {
    console.log([
      row.decision.padEnd(8),
      String(row.n).padStart(6),
      String(row.settled).padStart(7),
      String(row.hits).padStart(5),
      format(row.hitRate).padStart(7),
      format(row.roi).padStart(7),
      format(row.roiExMax).padStart(8),
      format(row.maxPayoutOdds).padStart(7),
    ].join("  "));
  }

  printDetails("top BUY misses", summary.topBuyMisses);
  printDetails("top WATCH/SKIP missed hits", summary.topMissedHits);
}

function printDetails(title: string, rows: DetailRow[]) {
  console.log("");
  console.log(title);
  console.log("date        venue      R   decision  selection  result    odds    ev      est");
  for (const row of rows) {
    console.log([
      row.date.padEnd(10),
      row.venue.padEnd(9),
      String(row.raceNo).padStart(2),
      row.decision.padEnd(8),
      row.selection.padEnd(9),
      String(row.result ?? "-").padEnd(8),
      format(row.currentOdds).padStart(7),
      format(row.ev).padStart(7),
      format(row.estimatedHitRate).padStart(7),
    ].join("  "));
  }
}

function columnExists(column: string): boolean {
  const rows = db.prepare("PRAGMA table_info(decision_history)").all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function pct(value: number | null) {
  return value == null ? "-" : `${(value * 100).toFixed(1)}%`;
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
    limit: 10,
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
    else if (key === "--limit") { parsed.limit = Math.max(1, Math.min(100, Number(value))); i += 1; }
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
  pnpm exec tsx scripts/report-review-summary.ts -- --from YYYY-MM-DD --to YYYY-MM-DD [--venue 蒲郡] [--limit 10] [--json]

Read-only. No external access.`);
}

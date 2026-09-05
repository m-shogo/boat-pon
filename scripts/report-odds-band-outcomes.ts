/**
 * オッズ帯ごとの decision 結果を見る read-only レポート。
 *
 * 目的:
 * - 高オッズBUYが危険すぎないか確認する
 * - 低オッズWATCH/SKIPを落としすぎていないか確認する
 * - current_odds / required_odds / odds_ratio の帯別に見る
 *
 * 注意:
 * - 読み取り専用
 * - 外部アクセスなし
 * - ROI は race_payouts.payout_yen の公式払戻を主評価にする
 * - hit の公式払戻が欠けるbandは ROI / roiExMax を N/A にして fail-closed にする
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error(`[report-odds-band-outcomes] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "odds-band outcomes primary database");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON");
db.exec("PRAGMA busy_timeout = 5000");

try {
  const rows = [
    ...queryMetric("current_odds", oddsBandSql("current_odds")),
    ...queryMetric("required_odds", oddsBandSql("required_odds")),
    ...queryMetric("odds_ratio", oddsRatioBandSql()),
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
  missingPayoutHits: number;
  hitRate: number | null;
  avgEstimatedHitRate: number | null;
  avgCurrentOdds: number | null;
  avgRequiredOdds: number | null;
  roi: number | null;
  roiExMax: number | null;
  maxPayoutOdds: number | null;
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
    required_odds,
    CASE
      WHEN selection = result AND returned = 0 THEN (
        SELECT rp.payout_yen / 100.0
        FROM race_payouts rp
        WHERE rp.race_id = decision_history.race_id
          AND rp.bet_type = decision_history.bet_type
          AND rp.combination = decision_history.selection
        LIMIT 1
      )
      ELSE 0
    END AS payout_units
  FROM decision_history
  WHERE ${where.join(" AND ")}
), grouped AS (
  SELECT
    band,
    decision,
    COUNT(*) AS n,
    SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END) AS settled,
    SUM(CASE WHEN selection = result AND returned = 0 THEN 1 ELSE 0 END) AS hits,
    SUM(CASE WHEN selection = result AND returned = 0 AND payout_units IS NULL THEN 1 ELSE 0 END) AS missing_payout_hits,
    AVG(estimated_hit_rate) AS avg_estimated_hit_rate,
    AVG(current_odds) AS avg_current_odds,
    AVG(required_odds) AS avg_required_odds,
    SUM(COALESCE(payout_units, 0)) AS total_payout_units,
    MAX(COALESCE(payout_units, 0)) AS max_payout_units
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
  missing_payout_hits AS missingPayoutHits,
  ROUND(hits * 1.0 / NULLIF(settled, 0), 4) AS hitRate,
  ROUND(avg_estimated_hit_rate, 4) AS avgEstimatedHitRate,
  ROUND(avg_current_odds, 2) AS avgCurrentOdds,
  ROUND(avg_required_odds, 2) AS avgRequiredOdds,
  CASE WHEN missing_payout_hits = 0
    THEN ROUND(total_payout_units * 1.0 / NULLIF(settled, 0), 3)
    ELSE NULL
  END AS roi,
  CASE WHEN missing_payout_hits = 0
    THEN ROUND((total_payout_units - max_payout_units) * 1.0 / NULLIF(settled - CASE WHEN max_payout_units > 0 THEN 1 ELSE 0 END, 0), 3)
    ELSE NULL
  END AS roiExMax,
  ROUND(max_payout_units, 2) AS maxPayoutOdds
FROM grouped
ORDER BY metric, band, CASE decision WHEN 'BUY' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'SKIP' THEN 3 ELSE 4 END
`;

  return db.prepare(sql).all(...params, metric) as ReportRow[];
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

function printRows(rows: ReportRow[]) {
  console.log("=== odds band outcomes report ===");
  console.log(`generated: ${new Date().toISOString()}`);
  console.log(`filters: from=${args.from ?? "-"} to=${args.to ?? "-"} venue=${args.venue ?? "-"} decision=${args.decision ?? "-"} model=${args.modelVersion ?? "-"} runKind=${args.runKind ?? "-"}`);
  console.log("");
  console.log("metric         band        decision  n      settled  hits   missPay  hitRate  estAvg  oddsAvg  reqAvg   roi     roiExMax  maxOdds");
  for (const row of rows) {
    console.log([
      row.metric.padEnd(13),
      row.band.padEnd(10),
      row.decision.padEnd(8),
      String(row.n).padStart(6),
      String(row.settled).padStart(7),
      String(row.hits).padStart(5),
      String(row.missingPayoutHits).padStart(7),
      format(row.hitRate).padStart(7),
      format(row.avgEstimatedHitRate).padStart(7),
      format(row.avgCurrentOdds).padStart(7),
      format(row.avgRequiredOdds).padStart(7),
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
  pnpm exec tsx scripts/report-odds-band-outcomes.ts -- --from YYYY-MM-DD --to YYYY-MM-DD [--venue 蒲郡] [--decision BUY|WATCH|SKIP] [--json]

Read-only. No external access.`);
}

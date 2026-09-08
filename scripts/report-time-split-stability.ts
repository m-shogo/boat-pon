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
 * - ROI主評価は race_payouts.payout_yen の実払戻。current_odds はband分割用の補助特徴のみ
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error("[report-time-split-stability] DB not found");
  process.exit(1);
}

if (!args.splitDate) {
  console.error("[report-time-split-stability] --split-date is required");
  process.exit(1);
}

const primaryDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "TIME_SPLIT_STABILITY_REPORT_PRIMARY_DB_IDENTITY_INVALID",
);
const db = new DatabaseSync(primaryDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000");

try {
  assertSupportedBetTypeMapping(args.from, args.to);
  assertOfficialSettlementIntegrity(args.from, args.to);
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
  missingPayoutHits: number;
  roi: number | null;
  roiExMax: number | null;
};

type StabilityRow = {
  metric: string;
  band: string;
  decision: string;
  beforeSettled: number;
  beforeHits: number;
  beforeMissingPayoutHits: number;
  beforeRoi: number | null;
  beforeRoiExMax: number | null;
  afterSettled: number;
  afterHits: number;
  afterMissingPayoutHits: number;
  afterRoi: number | null;
  afterRoiExMax: number | null;
  stability: "stable-good" | "stable-bad" | "reversed" | "insufficient" | "mixed";
};

function reportWhere(from: string | null, to: string | null): { where: string[]; params: Array<string | number> } {
  const where: string[] = ["1=1"];
  const params: Array<string | number> = [];
  if (from) { where.push("date >= ?"); params.push(from); }
  if (to) { where.push("date <= ?"); params.push(to); }
  if (args.venue) { where.push("venue = ?"); params.push(args.venue); }
  if (args.decision) { where.push("decision = ?"); params.push(args.decision); }
  if (args.modelVersion) { where.push("model_version = ?"); params.push(args.modelVersion); }
  if (args.runKind) { where.push("run_kind = ?"); params.push(args.runKind); }
  return { where, params };
}

function payoutBetTypeSql(column: string) {
  return `CASE ${column}
    WHEN '3連単' THEN 'trifecta'
    WHEN '3連複' THEN 'trio'
    WHEN '2連単' THEN 'exacta'
    WHEN '2連複' THEN 'quinella'
    WHEN '拡連複' THEN 'wide'
    WHEN 'trifecta' THEN 'trifecta'
    WHEN 'trio' THEN 'trio'
    WHEN 'exacta' THEN 'exacta'
    WHEN 'quinella' THEN 'quinella'
    WHEN 'wide' THEN 'wide'
    ELSE NULL
  END`;
}

function assertSupportedBetTypeMapping(from: string | null, to: string | null) {
  const { where, params } = reportWhere(from, to);
  const row = db.prepare(`
SELECT COUNT(*) AS n
FROM decision_history
WHERE ${where.join(" AND ")}
  AND (${payoutBetTypeSql("bet_type")}) IS NULL
`).get(...params) as { n: number };

  if (row.n > 0) {
    throw new Error(
      `TIME_SPLIT_STABILITY_BET_TYPE_MAPPING_FAILED: ${row.n} decision row(s) use an unsupported or unknown payout bet type mapping`,
    );
  }
}

function assertOfficialSettlementIntegrity(from: string | null, to: string | null) {
  const { where, params } = reportWhere(from, to);
  const row = db.prepare(`
WITH relevant_settled AS (
  SELECT DISTINCT
    race_id,
    bet_type,
    ${payoutBetTypeSql("bet_type")} AS payout_bet_type,
    result
  FROM decision_history
  WHERE ${where.join(" AND ")}
    AND result IS NOT NULL
    AND result != ''
    AND returned = 0
), invalid AS (
  SELECT s.race_id, s.bet_type, s.result
  FROM relevant_settled s
  WHERE s.payout_bet_type IS NULL
  OR (
    SELECT COUNT(*)
    FROM race_payouts rp
    WHERE rp.race_id = s.race_id
      AND rp.bet_type = s.payout_bet_type
      AND rp.combination = s.result
  ) != 1
  OR (
    SELECT COUNT(*)
    FROM race_payouts rp
    WHERE rp.race_id = s.race_id
      AND rp.bet_type = s.payout_bet_type
      AND rp.combination = s.result
      AND rp.returned = 0
      AND rp.payout_yen IS NOT NULL
      AND rp.payout_yen > 0
  ) != 1
)
SELECT COUNT(*) AS n FROM invalid
`).get(...params) as { n: number };

  if (row.n > 0) {
    throw new Error(
      `TIME_SPLIT_STABILITY_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED: ${row.n} settled race key(s) do not have exactly one positive non-refund official winning-result settlement`,
    );
  }
}

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
  const { where, params } = reportWhere(from, to);

  const sql = `
WITH base AS (
  SELECT
    ${bandExpr} AS band,
    decision,
    selection,
    result,
    returned,
    current_odds,
    CASE
      WHEN selection = result AND returned = 0 THEN (
        SELECT rp.payout_yen / 100.0
        FROM race_payouts rp
        WHERE rp.race_id = decision_history.race_id
          AND rp.bet_type = ${payoutBetTypeSql("decision_history.bet_type")}
          AND rp.combination = decision_history.selection
          AND rp.returned = 0
          AND rp.payout_yen > 0
        LIMIT 1
      )
      ELSE 0
    END AS payout_odds
  FROM decision_history
  WHERE ${where.join(" AND ")}
), grouped AS (
  SELECT
    band,
    decision,
    COUNT(*) AS n,
    SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END) AS settled,
    SUM(CASE WHEN selection = result AND returned = 0 THEN 1 ELSE 0 END) AS hits,
    SUM(CASE WHEN selection = result AND returned = 0 AND payout_odds IS NULL THEN 1 ELSE 0 END) AS missing_payout_hits,
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
  missing_payout_hits AS missingPayoutHits,
  CASE WHEN missing_payout_hits > 0 THEN NULL ELSE ROUND(total_payout_odds * 1.0 / NULLIF(settled, 0), 3) END AS roi,
  CASE WHEN missing_payout_hits > 0 THEN NULL ELSE ROUND((total_payout_odds - max_payout_odds) * 1.0 / NULLIF(settled - CASE WHEN max_payout_odds > 0 THEN 1 ELSE 0 END, 0), 3) END AS roiExMax
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
      beforeMissingPayoutHits: row.missingPayoutHits,
      beforeRoi: row.roi,
      beforeRoiExMax: row.roiExMax,
      afterSettled: 0,
      afterHits: 0,
      afterMissingPayoutHits: 0,
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
      beforeMissingPayoutHits: 0,
      beforeRoi: null,
      beforeRoiExMax: null,
      afterSettled: 0,
      afterHits: 0,
      afterMissingPayoutHits: 0,
      afterRoi: null,
      afterRoiExMax: null,
      stability: "insufficient" as const,
    };
    existing.afterSettled = row.settled;
    existing.afterHits = row.hits;
    existing.afterMissingPayoutHits = row.missingPayoutHits;
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
  if (row.beforeMissingPayoutHits > 0 || row.afterMissingPayoutHits > 0) return "insufficient";
  if (row.beforeRoi == null || row.beforeRoiExMax == null || row.afterRoi == null || row.afterRoiExMax == null) return "insufficient";
  const beforeGood = row.beforeRoi >= args.goodRoi && row.beforeRoiExMax >= args.goodRoiExMax;
  const afterGood = row.afterRoi >= args.goodRoi && row.afterRoiExMax >= args.goodRoiExMax;
  const beforeBad = row.beforeRoi <= args.badRoi && row.beforeRoiExMax <= args.badRoiExMax;
  const afterBad = row.afterRoi <= args.badRoi && row.afterRoiExMax <= args.badRoiExMax;
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
  console.log("roi basis: race_payouts.payout_yen (official payout per 100 yen, matching mapped decision bet_type/selection)");
  console.log("");
  console.log("stability      metric         band        decision  beforeN missing  beforeROI exMax    afterN  missing  afterROI  exMax");
  for (const row of rows) {
    console.log([
      row.stability.padEnd(14),
      row.metric.padEnd(13),
      row.band.padEnd(10),
      row.decision.padEnd(8),
      String(row.beforeSettled).padStart(7),
      String(row.beforeMissingPayoutHits).padStart(7),
      fmt(row.beforeRoi).padStart(9),
      fmt(row.beforeRoiExMax).padStart(7),
      String(row.afterSettled).padStart(7),
      String(row.afterMissingPayoutHits).padStart(7),
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

Read-only. No external access. ROI uses official race_payouts.payout_yen; every settled denominator must reconcile to exactly one positive non-refund official winning-result settlement before window aggregation.`);
}
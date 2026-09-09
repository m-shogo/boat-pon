/**
 * model_version 別の簡易比較レポート。
 *
 * read-only / 外部アクセスなし。
 * 新モデルが旧モデルより良いかを見る入口。
 * ROI主評価は race_payouts.payout_yen の公式実払戻。current_odds は補助特徴として平均のみ表示する。
 *
 * Usage:
 *   pnpm exec tsx scripts/report-model-version-simple.ts -- --from 2026-01-01 --to 2026-06-03
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error("[report-model-version-simple] DB not found");
  process.exit(1);
}

const primaryDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "MODEL_VERSION_REPORT_PRIMARY_DB_IDENTITY_INVALID",
);
const db = new DatabaseSync(primaryDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000");

try {
  assertSupportedBetTypeMapping();
  assertOfficialSettlementIntegrity();
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

function reportWhere(): { where: string[]; params: Array<string | number> } {
  const where: string[] = ["1=1"];
  const params: Array<string | number> = [];
  if (args.from) { where.push("date >= ?"); params.push(args.from); }
  if (args.to) { where.push("date <= ?"); params.push(args.to); }
  if (args.decision) { where.push("decision = ?"); params.push(args.decision); }
  if (args.venue) { where.push("venue = ?"); params.push(args.venue); }
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

function assertSupportedBetTypeMapping() {
  const { where, params } = reportWhere();
  const row = db.prepare(`
SELECT COUNT(*) AS n
FROM decision_history
WHERE ${where.join(" AND ")}
  AND (${payoutBetTypeSql("bet_type")}) IS NULL
`).get(...params) as { n: number };

  if (row.n > 0) {
    throw new Error(
      `MODEL_VERSION_BET_TYPE_MAPPING_FAILED: ${row.n} decision row(s) use an unsupported or unknown payout bet type mapping`,
    );
  }
}

function assertOfficialSettlementIntegrity() {
  const { where, params } = reportWhere();
  const row = db.prepare(`
WITH blank_settled AS (
  SELECT COUNT(*) AS n
  FROM decision_history
  WHERE ${where.join(" AND ")}
    AND result IS NOT NULL
    AND TRIM(result) = ''
    AND returned = 0
), relevant_settled AS (
  SELECT DISTINCT
    race_id,
    bet_type,
    ${payoutBetTypeSql("bet_type")} AS payout_bet_type,
    result
  FROM decision_history
  WHERE ${where.join(" AND ")}
    AND result IS NOT NULL
    AND TRIM(result) != ''
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
      AND rp.payout_yen > 0
  ) != 1
)
SELECT
  (SELECT n FROM blank_settled) AS blankResults,
  (SELECT COUNT(*) FROM invalid) AS invalid
`).get(...params, ...params) as { blankResults: number; invalid: number };

  if (row.blankResults > 0) {
    throw new Error(
      `MODEL_VERSION_BLANK_SETTLED_RESULT_UNSUPPORTED: ${row.blankResults} settled decision row(s) have a blank result and cannot enter model-version ROI denominators`,
    );
  }
  if (row.invalid > 0) {
    throw new Error(
      `MODEL_VERSION_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED: ${row.invalid} settled winning-result key(s) do not have a supported payout mapping and exactly one positive non-refund official settlement`,
    );
  }
}

function queryRows(): Row[] {
  const { where, params } = reportWhere();
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
    END AS payout_units
  FROM decision_history
  WHERE ${where.join(" AND ")}
), grouped AS (
  SELECT
    modelVersion,
    decision,
    COUNT(*) AS n,
    SUM(CASE WHEN result IS NOT NULL AND TRIM(result) != '' AND returned = 0 THEN 1 ELSE 0 END) AS settled,
    SUM(CASE WHEN result IS NOT NULL AND TRIM(result) != '' AND selection = result AND returned = 0 THEN 1 ELSE 0 END) AS hits,
    AVG(estimated_hit_rate) AS avgEstimatedHitRate,
    AVG(current_odds) AS avgCurrentOdds,
    SUM(payout_units) AS totalPayoutUnits,
    MAX(payout_units) AS maxPayoutUnits
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
  ROUND(totalPayoutUnits * 1.0 / NULLIF(settled, 0), 3) AS roi,
  ROUND((totalPayoutUnits - maxPayoutUnits) * 1.0 / NULLIF(settled - CASE WHEN maxPayoutUnits > 0 THEN 1 ELSE 0 END, 0), 3) AS roiExMax,
  ROUND(maxPayoutUnits, 2) AS maxPayoutOdds
FROM grouped
WHERE settled >= ?
ORDER BY modelVersion ASC, CASE decision WHEN 'BUY' THEN 1 WHEN 'WATCH' THEN 2 WHEN 'SKIP' THEN 3 ELSE 4 END
`).all(...params) as Row[];
}

function printRows(rows: Row[]) {
  console.log("=== model version simple report ===");
  console.log(`filters: from=${args.from ?? "-"} to=${args.to ?? "-"} venue=${args.venue ?? "-"} decision=${args.decision ?? "-"} minSettled=${args.minSettled}`);
  console.log("roi basis: race_payouts.payout_yen (official payout per 100 yen, matching mapped decision bet_type/selection)");
  console.log("");
  console.log("model            decision  n      settled  hits   hitRate  estAvg  oddsAvg  roi     exMax   maxPay");
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
  pnpm exec tsx scripts/report-model-version-simple.ts -- --from YYYY-MM-DD --to YYYY-MM-DD [--decision BUY] [--venue 蒲郡] [--min-settled 10] [--json]\n\nRead-only. Unsupported decision bet types and blank settled results fail closed before aggregation; ROI uses mapped canonical official race_payouts.payout_yen and current_odds is a quote-only feature.`);
}

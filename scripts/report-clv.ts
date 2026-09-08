/**
 * odds_timeseries_snapshots と decision_history を使った CLV 確認レポート。
 *
 * 読み取り専用。外部アクセスなし。
 *
 * 見ること:
 * - decision 別に T-30 / T-20 / T-10 / T-5 の平均オッズ
 * - T-30 から T-5 への変化率
 * - 結果確定済みの hit / ROI（公式 race_payouts.payout_yen 基準）
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseDecisionHistoryReportOptions } from "../src/research-replay/decisionHistoryReportOptions";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const rawArgs = process.argv.slice(2);
if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
  printHelp();
  process.exit(0);
}
const args = parseDecisionHistoryReportOptions(rawArgs);

if (!existsSync(DB_PATH)) {
  console.error("CLV_REPORT_DB_MISSING");
  process.exit(1);
}

const primaryDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "CLV_REPORT_PRIMARY_DB_IDENTITY_INVALID",
);
const db = new DatabaseSync(primaryDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000");

try {
  assertSupportedBetTypeMapping();
  assertOfficialSettlementIntegrity();
  const rows = queryRows();
  if (args.json) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      args,
      roiSource: "official race_payouts.payout_yen",
      rows,
    }, null, 2));
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

function reportWhere(): { where: string[]; params: Array<string | number> } {
  const where: string[] = ["1=1"];
  const params: Array<string | number> = [];

  if (args.from) { where.push("dh.date >= ?"); params.push(args.from); }
  if (args.to) { where.push("dh.date <= ?"); params.push(args.to); }
  if (args.decision) { where.push("dh.decision = ?"); params.push(args.decision); }
  if (args.modelVersion) { where.push("dh.model_version = ?"); params.push(args.modelVersion); }
  if (args.runKind) { where.push("dh.run_kind = ?"); params.push(args.runKind); }

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

function assertSupportedBetTypeMapping(): void {
  const { where, params } = reportWhere();
  const row = db.prepare(`
SELECT COUNT(*) AS invalid
FROM decision_history dh
WHERE ${where.join(" AND ")}
  AND (${payoutBetTypeSql("dh.bet_type")}) IS NULL
`).get(...params) as { invalid: number | bigint | null };

  const invalid = Number(row.invalid ?? 0);
  if (!Number.isSafeInteger(invalid) || invalid < 0) {
    throw new Error("CLV_REPORT_BET_TYPE_MAPPING_COUNT_INVALID");
  }
  if (invalid > 0) {
    throw new Error("CLV_REPORT_BET_TYPE_MAPPING_FAILED");
  }
}

function assertOfficialSettlementIntegrity(): void {
  const { where, params } = reportWhere();
  const row = db.prepare(`
WITH relevant_hits AS (
  SELECT DISTINCT
    dh.race_id,
    dh.bet_type,
    ${payoutBetTypeSql("dh.bet_type")} AS payout_bet_type,
    dh.selection
  FROM decision_history dh
  WHERE ${where.join(" AND ")}
    AND dh.result IS NOT NULL
    AND dh.returned = 0
    AND dh.selection = dh.result
), invalid AS (
  SELECT h.race_id, h.bet_type, h.selection
  FROM relevant_hits h
  WHERE h.payout_bet_type IS NULL
  OR (
    SELECT COUNT(*)
    FROM race_payouts rp
    WHERE rp.race_id = h.race_id
      AND rp.bet_type = h.payout_bet_type
      AND rp.combination = h.selection
  ) != 1
  OR (
    SELECT COUNT(*)
    FROM race_payouts rp
    WHERE rp.race_id = h.race_id
      AND rp.bet_type = h.payout_bet_type
      AND rp.combination = h.selection
      AND rp.returned = 0
      AND rp.payout_yen IS NOT NULL
      AND rp.payout_yen > 0
  ) != 1
)
SELECT COUNT(*) AS invalid FROM invalid
`).get(...params) as { invalid: number | bigint | null };

  const invalid = Number(row.invalid ?? 0);
  if (!Number.isSafeInteger(invalid) || invalid < 0) {
    throw new Error("CLV_REPORT_SETTLEMENT_COUNT_INVALID");
  }
  if (invalid > 0) {
    throw new Error("CLV_REPORT_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED");
  }
}

function queryRows(): ReportRow[] {
  const { where, params } = reportWhere();

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
    CASE
      WHEN dh.selection = dh.result AND dh.returned = 0 THEN (
        SELECT rp.payout_yen / 100.0
        FROM race_payouts rp
        WHERE rp.race_id = dh.race_id
          AND rp.bet_type = ${payoutBetTypeSql("dh.bet_type")}
          AND rp.combination = dh.selection
          AND rp.returned = 0
          AND rp.payout_yen IS NOT NULL
          AND rp.payout_yen > 0
        LIMIT 1
      )
      ELSE 0
    END AS payout_units,
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
    SUM(payout_units) * 1.0
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
  console.log("roi basis: race_payouts.payout_yen (official payout per 100 yen, matching mapped decision bet_type/selection)");
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

function printHelp() {
  console.log(`Usage:
  pnpm exec tsx scripts/report-clv.ts -- --from YYYY-MM-DD --to YYYY-MM-DD [--decision BUY|WATCH|SKIP] [--model-version X] [--run-kind paper-live] [--json]

Read-only. Unsupported decision bet types fail closed before CLV/ROI aggregation; CLV uses aggregate checkpoint odds and ROI uses mapped canonical official race_payouts.payout_yen.`);
}

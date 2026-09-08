/**
 * decision_history の decision 別結果比較レポート。
 *
 * 読み取り専用。外部アクセスなし。
 *
 * 見ること:
 * - BUY / WATCH / SKIP が実際どうだったか
 * - WATCH で当たっていたもの、SKIP で来ていたものを検証する
 * - ROI と ROI excluding max payout を併記する
 *
 * ROI主評価は race_payouts.payout_yen の実払戻。current_odds は補助特徴として平均のみ表示する。
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error("[report-decision-outcomes] DB not found");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "DECISION_OUTCOMES_PRIMARY_DB_IDENTITY_INVALID",
);
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000");

try {
  assertSupportedBetTypeMapping();
  assertOfficialSettlementIntegrity();
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
  missingPayoutHits: number;
  hitRate: number | null;
  avgEstimatedHitRate: number | null;
  avgCurrentOdds: number | null;
  roi: number | null;
  roiExMax: number | null;
  maxPayoutOdds: number | null;
  avgEv: number | null;
};

function reportWhere(): { where: string[]; params: Array<string | number> } {
  const where: string[] = ["1=1"];
  const params: Array<string | number> = [];

  if (args.from) { where.push("date >= ?"); params.push(args.from); }
  if (args.to) { where.push("date <= ?"); params.push(args.to); }
  if (args.venue) { where.push("venue = ?"); params.push(args.venue); }
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
      `DECISION_OUTCOMES_BET_TYPE_MAPPING_FAILED: ${row.n} decision row(s) use an unsupported or unknown payout bet type mapping`,
    );
  }
}

function assertOfficialSettlementIntegrity() {
  const { where, params } = reportWhere();
  const row = db.prepare(`
WITH relevant_hits AS (
  SELECT DISTINCT
    race_id,
    bet_type,
    ${payoutBetTypeSql("bet_type")} AS payout_bet_type,
    selection
  FROM decision_history
  WHERE ${where.join(" AND ")}
    AND selection = result
    AND returned = 0
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
      AND rp.payout_yen > 0
  ) != 1
)
SELECT COUNT(*) AS n FROM invalid
`).get(...params) as { n: number };

  if (row.n > 0) {
    throw new Error(
      `DECISION_OUTCOMES_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED: ${row.n} winning ticket key(s) do not have exactly one positive non-refund official settlement`,
    );
  }
}

function queryRows(): ReportRow[] {
  const { where, params } = reportWhere();

  const sql = `
WITH base AS (
  SELECT
    decision,
    selection,
    result,
    returned,
    estimated_hit_rate,
    current_odds,
    ev,
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
    decision,
    COUNT(*) AS n,
    SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END) AS settled,
    SUM(CASE WHEN selection = result AND returned = 0 THEN 1 ELSE 0 END) AS hits,
    SUM(CASE WHEN selection = result AND returned = 0 AND payout_odds IS NULL THEN 1 ELSE 0 END) AS missing_payout_hits,
    AVG(estimated_hit_rate) AS avg_estimated_hit_rate,
    AVG(current_odds) AS avg_current_odds,
    AVG(ev) AS avg_ev,
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
  missing_payout_hits AS missingPayoutHits,
  ROUND(hits * 1.0 / NULLIF(settled, 0), 4) AS hitRate,
  ROUND(avg_estimated_hit_rate, 4) AS avgEstimatedHitRate,
  ROUND(avg_current_odds, 2) AS avgCurrentOdds,
  CASE WHEN missing_payout_hits > 0 THEN NULL ELSE ROUND(total_payout_odds * 1.0 / NULLIF(settled, 0), 3) END AS roi,
  CASE WHEN missing_payout_hits > 0 THEN NULL ELSE ROUND((total_payout_odds - max_payout_odds) * 1.0 / NULLIF(settled - CASE WHEN max_payout_odds > 0 THEN 1 ELSE 0 END, 0), 3) END AS roiExMax,
  CASE WHEN missing_payout_hits > 0 THEN NULL ELSE ROUND(max_payout_odds, 2) END AS maxPayoutOdds,
  ROUND(avg_ev, 3) AS avgEv
FROM grouped
ORDER BY CASE decision
  WHEN 'BUY' THEN 1
  WHEN 'WATCH' THEN 2
  WHEN 'SKIP' THEN 3
  ELSE 4
END
`;

  return db.prepare(sql).all(...params) as ReportRow[];
}

function printRows(rows: ReportRow[]) {
  console.log("=== decision outcomes report ===");
  console.log(`generated: ${new Date().toISOString()}`);
  console.log(`filters: from=${args.from ?? "-"} to=${args.to ?? "-"} venue=${args.venue ?? "-"} model=${args.modelVersion ?? "-"} runKind=${args.runKind ?? "-"}`);
  console.log("roi basis: race_payouts.payout_yen (official payout per 100 yen, matching mapped decision bet_type/selection)");
  console.log("");
  console.log("decision  n      settled  hits   missing  hitRate  estAvg  oddsAvg  avgEv   roi     roiExMax  maxPayout");
  for (const row of rows) {
    console.log([
      row.decision.padEnd(8),
      String(row.n).padStart(6),
      String(row.settled).padStart(7),
      String(row.hits).padStart(5),
      String(row.missingPayoutHits).padStart(7),
      format(row.hitRate).padStart(7),
      format(row.avgEstimatedHitRate).padStart(7),
      format(row.avgCurrentOdds).padStart(7),
      format(row.avgEv).padStart(7),
      format(row.roi).padStart(7),
      format(row.roiExMax).padStart(8),
      format(row.maxPayoutOdds).padStart(9),
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
  pnpm exec tsx scripts/report-decision-outcomes.ts -- --from YYYY-MM-DD --to YYYY-MM-DD [--venue 蒲郡] [--model-version X] [--run-kind paper-live] [--json]\n\nRead-only. No external access. ROI uses official race_payouts.payout_yen; winning ticket keys must have exactly one positive non-refund official settlement before payout-derived metrics are generated.`);
}

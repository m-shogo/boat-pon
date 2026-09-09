/**
 * 市場の逆行・追認を確認する read-only 警告レポート。
 *
 * 目的:
 * - BUYなのに締切前に市場が嫌っている候補を探す
 * - WATCH/SKIPなのに締切前に市場が買っている候補を探す
 * - private checkpoint snapshot 自体は出力せず、変化率・順位差だけを確認する
 *
 * 注意:
 * - 読み取り専用
 * - 外部アクセスなし
 * - 自動購入・投票操作なし
 * - row-level T-30/T-5 odds/popularity は標準出力・JSONへ露出しない
 */

import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "market warnings primary database");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

try {
  assertSupportedBetTypeMapping();
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
  warning: string;
  date: string;
  venue: string;
  raceNo: number;
  decision: string;
  selection: string;
  result: string | null;
  currentOdds: number | null;
  ev: number | null;
  oddsChangeRate: number | null;
  popularityDelta: number | null;
};

function canonicalBetTypeSql(column: string) {
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

function reportWhere(): { where: string[]; params: Array<string | number> } {
  const where: string[] = ["1=1"];
  const params: Array<string | number> = [];

  if (args.from) { where.push("dh.date >= ?"); params.push(args.from); }
  if (args.to) { where.push("dh.date <= ?"); params.push(args.to); }
  if (args.venue) { where.push("dh.venue = ?"); params.push(args.venue); }
  if (args.decision) { where.push("dh.decision = ?"); params.push(args.decision); }
  if (args.modelVersion) { where.push("dh.model_version = ?"); params.push(args.modelVersion); }
  if (args.runKind) { where.push("dh.run_kind = ?"); params.push(args.runKind); }

  return { where, params };
}

function assertSupportedBetTypeMapping(): void {
  const { where, params } = reportWhere();
  const row = db.prepare(`
SELECT COUNT(*) AS invalid
FROM decision_history dh
WHERE ${where.join(" AND ")}
  AND (${canonicalBetTypeSql("dh.bet_type")}) IS NULL
`).get(...params) as { invalid: number | bigint | null };

  const invalid = Number(row.invalid ?? 0);
  if (!Number.isSafeInteger(invalid) || invalid < 0) {
    throw new Error("MARKET_WARNINGS_BET_TYPE_MAPPING_COUNT_INVALID");
  }
  if (invalid > 0) {
    throw new Error("MARKET_WARNINGS_BET_TYPE_MAPPING_FAILED");
  }
}

function queryRows(): ReportRow[] {
  const { where, params } = reportWhere();
  params.push(args.limit);

  const sql = `
WITH ranked AS (
  SELECT
    race_id,
    bet_type,
    selection,
    checkpoint_label,
    odds,
    popularity,
    ROW_NUMBER() OVER (
      PARTITION BY race_id, bet_type, selection, checkpoint_label
      ORDER BY captured_at DESC
    ) AS rn
  FROM odds_timeseries_snapshots
  WHERE checkpoint_label IN ('T-30', 'T-5')
), pivoted AS (
  SELECT
    race_id,
    bet_type,
    selection,
    MAX(CASE WHEN checkpoint_label = 'T-30' THEN odds END) AS t30_odds,
    MAX(CASE WHEN checkpoint_label = 'T-5' THEN odds END) AS t5_odds,
    MAX(CASE WHEN checkpoint_label = 'T-30' THEN popularity END) AS t30_popularity,
    MAX(CASE WHEN checkpoint_label = 'T-5' THEN popularity END) AS t5_popularity
  FROM ranked
  WHERE rn = 1
  GROUP BY race_id, bet_type, selection
), joined AS (
  SELECT
    dh.date,
    dh.venue,
    dh.race_no AS raceNo,
    dh.decision,
    dh.selection,
    dh.result,
    dh.current_odds AS currentOdds,
    dh.ev,
    CASE WHEN p.t30_odds IS NOT NULL AND p.t5_odds IS NOT NULL AND p.t30_odds > 0
      THEN (p.t5_odds - p.t30_odds) * 1.0 / p.t30_odds
      ELSE NULL
    END AS oddsChangeRate,
    CASE WHEN p.t30_popularity IS NOT NULL AND p.t5_popularity IS NOT NULL
      THEN p.t5_popularity - p.t30_popularity
      ELSE NULL
    END AS popularityDelta
  FROM decision_history dh
  LEFT JOIN pivoted p
    ON p.race_id = dh.race_id
   AND p.bet_type = ${canonicalBetTypeSql("dh.bet_type")}
   AND p.selection = dh.selection
  WHERE ${where.join(" AND ")}
), warnings AS (
  SELECT
    CASE
      WHEN decision = 'BUY' AND oddsChangeRate >= 0.30 THEN 'BUY_odds_worsened'
      WHEN decision = 'BUY' AND popularityDelta >= 10 THEN 'BUY_popularity_worsened'
      WHEN decision IN ('WATCH', 'SKIP') AND oddsChangeRate <= -0.20 THEN 'WATCH_SKIP_odds_improved'
      WHEN decision IN ('WATCH', 'SKIP') AND popularityDelta <= -10 THEN 'WATCH_SKIP_popularity_improved'
      ELSE NULL
    END AS warning,
    *
  FROM joined
)
SELECT
  warning,
  date,
  venue,
  raceNo,
  decision,
  selection,
  result,
  currentOdds,
  ev,
  ROUND(oddsChangeRate, 4) AS oddsChangeRate,
  popularityDelta
FROM warnings
WHERE warning IS NOT NULL
ORDER BY date DESC, venue ASC, raceNo ASC, warning ASC
LIMIT ?
`;

  return db.prepare(sql).all(...params) as ReportRow[];
}

function printRows(rows: ReportRow[]) {
  console.log("=== market warnings report ===");
  console.log(`generated: ${new Date().toISOString()}`);
  console.log(`filters: from=${args.from ?? "-"} to=${args.to ?? "-"} venue=${args.venue ?? "-"} decision=${args.decision ?? "-"} model=${args.modelVersion ?? "-"} runKind=${args.runKind ?? "-"} limit=${args.limit}`);
  console.log("checkpoint privacy: row-level T-30/T-5 odds/popularity withheld; derived movement only");
  console.log("");
  console.log("warning                         date        venue      R   decision  selection  odds    ev      oddsΔ    popΔ");
  for (const row of rows) {
    console.log([
      row.warning.padEnd(31),
      row.date.padEnd(10),
      row.venue.padEnd(9),
      String(row.raceNo).padStart(2),
      row.decision.padEnd(8),
      row.selection.padEnd(9),
      fmt(row.currentOdds).padStart(7),
      fmt(row.ev).padStart(7),
      fmt(row.oddsChangeRate).padStart(7),
      String(row.popularityDelta ?? "-").padStart(5),
    ].join("  "));
  }
}

function fmt(value: number | null) {
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
    limit: 100,
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
    else if (key === "--limit") { parsed.limit = Math.max(1, Math.min(1000, Number(value))); i += 1; }
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
  pnpm exec tsx scripts/report-market-warnings.ts -- --from YYYY-MM-DD --to YYYY-MM-DD [--venue 蒲郡] [--decision BUY|WATCH|SKIP] [--limit 100] [--json]

Read-only. Unsupported decision bet types fail closed; checkpoint movement is matched by canonical bet type + selection. Row-level private checkpoint odds/popularity are not emitted. No external access.`);
}

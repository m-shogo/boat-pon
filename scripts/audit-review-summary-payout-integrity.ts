import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const rawArgs = process.argv.slice(2);
if (rawArgs.includes("--help") || rawArgs.includes("-h")) process.exit(0);

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

try {
  const { where, params } = reportWhere(rawArgs);
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
      AND rp.payout_yen IS NOT NULL
      AND rp.payout_yen > 0
  ) != 1
)
SELECT
  (SELECT n FROM blank_settled) AS blankResults,
  (SELECT COUNT(*) FROM invalid) AS invalid
`).get(...params, ...params) as { blankResults: number; invalid: number };

  if ((row.blankResults ?? 0) > 0) {
    console.error(
      `REVIEW_SUMMARY_BLANK_SETTLED_RESULT_UNSUPPORTED: ${row.blankResults} settled decision row(s) have a blank result and would otherwise enter the raw report denominator`,
    );
    process.exitCode = 2;
  } else if ((row.invalid ?? 0) > 0) {
    console.error(
      `REVIEW_SUMMARY_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED: ${row.invalid} settled decision denominator race(s) do not have a supported payout mapping and exactly one positive non-refund official winning settlement`,
    );
    process.exitCode = 2;
  }
} finally {
  db.close();
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

function reportWhere(argv: string[]) {
  const where = ["1=1"];
  const params: Array<string | number> = [];

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--from") { where.push("date >= ?"); params.push(requireDate(value, key)); i += 1; }
    else if (key === "--to") { where.push("date <= ?"); params.push(requireDate(value, key)); i += 1; }
    else if (key === "--venue") { where.push("venue = ?"); params.push(requireValue(value, key)); i += 1; }
    else if (key === "--model-version") { where.push("model_version = ?"); params.push(requireValue(value, key)); i += 1; }
    else if (key === "--run-kind") { where.push("run_kind = ?"); params.push(requireValue(value, key)); i += 1; }
    else if (key === "--limit") { requireValue(value, key); i += 1; }
    else if (key === "--json" || key === "--") { /* report-only option */ }
    else throw new Error(`unknown option: ${key}`);
  }

  return { where, params };
}

function requireValue(value: string | undefined, key: string) {
  if (!value) throw new Error(`${key} requires a value`);
  return value;
}

function requireDate(value: string | undefined, key: string) {
  const date = requireValue(value, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${key} must be YYYY-MM-DD`);
  return date;
}
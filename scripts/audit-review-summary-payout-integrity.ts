import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

try {
  const { where, params } = reportWhere(process.argv.slice(2));
  const row = db.prepare(`
WITH relevant_hits AS (
  SELECT DISTINCT race_id, bet_type, selection
  FROM decision_history
  WHERE ${where.join(" AND ")}
    AND result IS NOT NULL
    AND returned = 0
    AND selection = result
), invalid AS (
  SELECT h.race_id, h.bet_type, h.selection
  FROM relevant_hits h
  WHERE (
    SELECT COUNT(*)
    FROM race_payouts rp
    WHERE rp.race_id = h.race_id
      AND rp.bet_type = h.bet_type
      AND rp.combination = h.selection
  ) != 1
  OR (
    SELECT COUNT(*)
    FROM race_payouts rp
    WHERE rp.race_id = h.race_id
      AND rp.bet_type = h.bet_type
      AND rp.combination = h.selection
      AND rp.returned = 0
      AND rp.payout_yen > 0
  ) != 1
)
SELECT COUNT(*) AS n FROM invalid
`).get(...params) as { n: number };

  if ((row.n ?? 0) > 0) {
    console.error(
      `REVIEW_SUMMARY_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED: ${row.n} winning decision key(s) do not have exactly one positive non-refund official settlement`,
    );
    process.exitCode = 2;
  }
} finally {
  db.close();
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
    else if (key === "--help" || key === "-h") { /* raw report handles help after audit */ }
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

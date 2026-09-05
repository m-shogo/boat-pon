import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const REQUIRED_BET_TYPES = ["trifecta", "trio", "exacta", "quinella", "wide"] as const;

function q(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const betTypes = REQUIRED_BET_TYPES.map(q).join(",");
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

try {
  const rows = db.prepare(`
    WITH population AS (
      SELECT DISTINCT dh.race_id
      FROM decision_history dh
      WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
        AND dh.result IS NOT NULL AND dh.result != ''
    ), required(bet_type) AS (
      VALUES ${REQUIRED_BET_TYPES.map((betType) => `(${q(betType)})`).join(",")}
    ), settled AS (
      SELECT DISTINCT rp.race_id, rp.bet_type
      FROM race_payouts rp
      WHERE rp.bet_type IN (${betTypes})
    )
    SELECT
      r.bet_type,
      COUNT(p.race_id) AS total,
      SUM(CASE WHEN s.race_id IS NOT NULL THEN 1 ELSE 0 END) AS settled
    FROM required r
    CROSS JOIN population p
    LEFT JOIN settled s ON s.race_id = p.race_id AND s.bet_type = r.bet_type
    GROUP BY r.bet_type
    ORDER BY r.bet_type
  `).all() as { bet_type: string; total: number; settled: number | null }[];

  const coverage = Object.fromEntries(REQUIRED_BET_TYPES.map((betType) => {
    const row = rows.find((candidate) => candidate.bet_type === betType);
    const total = Number(row?.total ?? 0);
    const settled = Number(row?.settled ?? 0);
    const missing = total - settled;
    return [betType, { total, settled, missing }];
  }));

  console.log(JSON.stringify({ coverage }));

  const invalid = REQUIRED_BET_TYPES.some((betType) => {
    const { total, settled, missing } = coverage[betType];
    return !Number.isInteger(total)
      || !Number.isInteger(settled)
      || !Number.isInteger(missing)
      || total <= 0
      || settled !== total
      || missing !== 0;
  });

  if (invalid) {
    console.error(`ALL_BET_TYPE_SCREENING_PAYOUT_COVERAGE_INCOMPLETE ${JSON.stringify(coverage)}`);
    process.exitCode = 2;
  }
} finally {
  db.close();
}

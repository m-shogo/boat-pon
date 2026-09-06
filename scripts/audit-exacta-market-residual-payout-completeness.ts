import { DatabaseSync } from "node:sqlite";
import {
  HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING,
  historicalExactaCanonicalSourcePredicate,
} from "../src/research-replay/historicalExactaMarketAuthority";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const HELDOUT_END = "2024-12-31";
const FORWARD_START = "2025-01-01";

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

try {
  const rows = db.prepare(`
    WITH population AS (
      SELECT
        hao.race_id,
        hao.race_date AS date
      FROM historical_alternative_odds hao
      WHERE hao.bet_type = 'exacta'
        AND ${historicalExactaCanonicalSourcePredicate("hao")}
      GROUP BY hao.race_id
      HAVING ${HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING}
        AND COALESCE((
          SELECT COUNT(*)
          FROM race_entries re
          WHERE re.race_id = hao.race_id AND re.status_code = 'F'
        ), 0) = 0
    ), settlement AS (
      SELECT
        rp.race_id,
        CASE
          WHEN COUNT(*) = 1
            AND SUM(CASE WHEN rp.payout_yen IS NOT NULL AND rp.payout_yen > 0 THEN 1 ELSE 0 END) = 1
            AND MAX(CASE WHEN rp.payout_yen IS NOT NULL AND rp.payout_yen > 0 AND EXISTS (
              SELECT 1
              FROM historical_alternative_odds winner_hao
              WHERE winner_hao.race_id = rp.race_id
                AND winner_hao.bet_type = 'exacta'
                AND ${historicalExactaCanonicalSourcePredicate("winner_hao")}
                AND winner_hao.combination = rp.combination
            ) THEN 1 ELSE 0 END) = 1
          THEN 1 ELSE 0
        END AS settled
      FROM race_payouts rp
      WHERE rp.bet_type = 'exacta'
      GROUP BY rp.race_id
    )
    SELECT
      CASE
        WHEN p.date <= ? THEN 'heldout'
        WHEN p.date >= ? THEN 'forward'
        ELSE 'gap'
      END AS period,
      COUNT(*) AS total,
      SUM(COALESCE(s.settled, 0)) AS settled
    FROM population p
    LEFT JOIN settlement s ON s.race_id = p.race_id
    GROUP BY period
    ORDER BY period
  `).all(HELDOUT_END, FORWARD_START) as Array<{ period: string; total: number; settled: number }>;

  const byPeriod = Object.fromEntries(["heldout", "forward"].map((period) => {
    const row = rows.find((candidate) => candidate.period === period);
    const total = Number(row?.total ?? 0);
    const settled = Number(row?.settled ?? 0);
    return [period, { total, settled, missing: total - settled }];
  }));

  const allTotal = rows.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
  const allSettled = rows.reduce((sum, row) => sum + Number(row.settled ?? 0), 0);
  const all = { total: allTotal, settled: allSettled, missing: allTotal - allSettled };

  console.log(JSON.stringify({ betType: "exacta", population: "canonical-complete-no-F", byPeriod, all }));

  const periodInvalid = ["heldout", "forward"].some((period) => {
    const { total, settled, missing } = byPeriod[period];
    return !Number.isInteger(total)
      || !Number.isInteger(settled)
      || total <= 0
      || settled !== total
      || missing !== 0;
  });
  const allInvalid = !Number.isInteger(all.total)
    || !Number.isInteger(all.settled)
    || all.total <= 0
    || all.settled !== all.total
    || all.missing !== 0;

  if (periodInvalid || allInvalid) {
    console.error(`EXACTA_MARKET_RESIDUAL_PAYOUT_COVERAGE_INCOMPLETE ${JSON.stringify({ byPeriod, all })}`);
    process.exitCode = 2;
  }
} finally {
  db.close();
}

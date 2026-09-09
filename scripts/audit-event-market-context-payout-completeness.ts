import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";
import {
  HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING,
  historicalExactaCanonicalSourcePredicate,
} from "../src/research-replay/historicalExactaMarketAuthority";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

try {
  const rows = db.prepare(`
    WITH market_population AS (
      SELECT h.race_id, h.race_date AS date
      FROM historical_alternative_odds h
      JOIN official_programs op ON op.race_id = h.race_id
      WHERE h.bet_type = 'exacta'
        AND ${historicalExactaCanonicalSourcePredicate("h")}
        AND h.race_date BETWEEN '2024-01-01' AND '2025-12-31'
        AND NOT EXISTS (
          SELECT 1 FROM race_entries re
          WHERE re.race_id = h.race_id AND re.status_code = 'F'
        )
      GROUP BY h.race_id
      HAVING ${HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING}
        AND MAX(CASE WHEN h.combination = '1-4' THEN h.odds END) IS NOT NULL
    ), settlement AS (
      SELECT rp.race_id,
        COUNT(*) AS payout_rows,
        SUM(CASE WHEN rp.returned = 0 AND rp.payout_yen IS NOT NULL AND rp.payout_yen > 0 AND rp.combination IS NOT NULL AND trim(rp.combination) != ''
          AND EXISTS (
            SELECT 1 FROM historical_alternative_odds winner_h
            WHERE winner_h.race_id = rp.race_id
              AND winner_h.bet_type = 'exacta'
              AND ${historicalExactaCanonicalSourcePredicate("winner_h")}
              AND winner_h.combination = rp.combination
          ) THEN 1 ELSE 0 END) AS valid_rows
      FROM race_payouts rp
      WHERE rp.bet_type = 'exacta'
      GROUP BY rp.race_id
    )
    SELECT
      CASE WHEN p.date <= '2024-12-31' THEN 'discovery' ELSE 'forward' END AS period,
      COUNT(*) AS total,
      SUM(CASE WHEN s.payout_rows = 1 AND s.valid_rows = 1 THEN 1 ELSE 0 END) AS settled,
      SUM(CASE WHEN COALESCE(s.payout_rows, 0) > 1 THEN 1 ELSE 0 END) AS ambiguous
    FROM market_population p
    LEFT JOIN settlement s ON s.race_id = p.race_id
    GROUP BY period
    ORDER BY period
  `).all() as Array<{ period: string; total: number; settled: number; ambiguous: number }>;

  const byPeriod = Object.fromEntries(["discovery", "forward"].map((period) => {
    const row = rows.find((candidate) => candidate.period === period);
    const total = Number(row?.total ?? 0);
    const settled = Number(row?.settled ?? 0);
    const ambiguous = Number(row?.ambiguous ?? 0);
    return [period, { total, settled, missing: total - settled, ambiguous }];
  }));

  console.log(JSON.stringify({ betType: "exacta", combination: "1-4", byPeriod }));

  const invalid = ["discovery", "forward"].some((period) => {
    const { total, settled, missing, ambiguous } = byPeriod[period];
    return !Number.isInteger(total)
      || !Number.isInteger(settled)
      || !Number.isInteger(ambiguous)
      || total <= 0
      || settled !== total
      || missing !== 0
      || ambiguous !== 0;
  });

  if (invalid) {
    console.error(`EVENT_MARKET_CONTEXT_PAYOUT_COVERAGE_INCOMPLETE ${JSON.stringify(byPeriod)}`);
    process.exitCode = 2;
  }
} finally {
  db.close();
}

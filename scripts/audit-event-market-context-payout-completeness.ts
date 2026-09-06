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
      SELECT race_id,
        MAX(CASE WHEN payout_yen IS NOT NULL AND payout_yen > 0 THEN 1 ELSE 0 END) AS settled
      FROM race_payouts
      WHERE bet_type = 'exacta'
      GROUP BY race_id
    )
    SELECT
      CASE WHEN p.date <= '2024-12-31' THEN 'discovery' ELSE 'forward' END AS period,
      COUNT(*) AS total,
      SUM(COALESCE(s.settled, 0)) AS settled
    FROM market_population p
    LEFT JOIN settlement s ON s.race_id = p.race_id
    GROUP BY period
    ORDER BY period
  `).all() as Array<{ period: string; total: number; settled: number }>;

  const byPeriod = Object.fromEntries(["discovery", "forward"].map((period) => {
    const row = rows.find((candidate) => candidate.period === period);
    const total = Number(row?.total ?? 0);
    const settled = Number(row?.settled ?? 0);
    return [period, { total, settled, missing: total - settled }];
  }));

  console.log(JSON.stringify({ betType: "exacta", combination: "1-4", byPeriod }));

  const invalid = ["discovery", "forward"].some((period) => {
    const { total, settled, missing } = byPeriod[period];
    return !Number.isInteger(total)
      || !Number.isInteger(settled)
      || total <= 0
      || settled !== total
      || missing !== 0;
  });

  if (invalid) {
    console.error(`EVENT_MARKET_CONTEXT_PAYOUT_COVERAGE_INCOMPLETE ${JSON.stringify(byPeriod)}`);
    process.exitCode = 2;
  }
} finally {
  db.close();
}

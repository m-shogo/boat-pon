/**
 * Fail-closed launcher for analyze-local-market-anomalies.ts.
 * Historical closing-odds research only. No T-5/private/production/BUY wiring.
 */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING,
  historicalExactaCanonicalSourcePredicate,
} from "../src/research-replay/historicalExactaMarketAuthority";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(DB_PATH)) throw new Error(`LOCAL_MARKET_PRIMARY_DB_MISSING ${DB_PATH}`);

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "LOCAL_MARKET_PRIMARY_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");

type CoverageRow = { period: string; total: number; settled: number };

try {
  const coverage = db.prepare(`
    WITH population AS (
      SELECT h.race_id, h.race_date AS date
      FROM historical_alternative_odds h
      JOIN official_programs op ON op.race_id=h.race_id
      WHERE h.bet_type='exacta'
        AND ${historicalExactaCanonicalSourcePredicate("h")}
        AND h.race_date BETWEEN '2024-01-01' AND '2025-12-31'
        AND json_type(op.raw_json, '$.boats')='array'
        AND NOT EXISTS (
          SELECT 1 FROM race_entries re
          WHERE re.race_id=h.race_id AND re.status_code='F'
        )
      GROUP BY h.race_id
      HAVING ${HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING}
        AND MAX(CASE WHEN h.combination='1-2' THEN h.odds END) IS NOT NULL
        AND MAX(CASE WHEN h.combination='1-3' THEN h.odds END) IS NOT NULL
        AND MAX(CASE WHEN h.combination='1-4' THEN h.odds END) IS NOT NULL
    ), settlement AS (
      SELECT rp.race_id,
        CASE WHEN COUNT(*)=1
          AND SUM(CASE WHEN rp.payout_yen IS NOT NULL AND rp.payout_yen>0 THEN 1 ELSE 0 END)=1
          AND MAX(CASE WHEN EXISTS (
            SELECT 1 FROM historical_alternative_odds winner_h
            WHERE winner_h.race_id=rp.race_id
              AND winner_h.bet_type='exacta'
              AND ${historicalExactaCanonicalSourcePredicate("winner_h")}
              AND winner_h.combination=rp.combination
          ) THEN 1 ELSE 0 END)=1
        THEN 1 ELSE 0 END AS settled
      FROM race_payouts rp
      WHERE rp.bet_type='exacta'
      GROUP BY rp.race_id
    )
    SELECT CASE WHEN p.date<'2025-01-01' THEN 'discovery' ELSE 'forward' END AS period,
      COUNT(*) AS total,
      SUM(COALESCE(s.settled,0)) AS settled
    FROM population p
    LEFT JOIN settlement s ON s.race_id=p.race_id
    GROUP BY period
    ORDER BY period
  `).all() as CoverageRow[];

  const byPeriod = Object.fromEntries(["discovery", "forward"].map(period => {
    const row = coverage.find(candidate => candidate.period === period);
    const total = Number(row?.total ?? 0);
    const settled = Number(row?.settled ?? 0);
    return [period, { total, settled, missing: total - settled }];
  }));

  const invalid = ["discovery", "forward"].some(period => {
    const { total, settled, missing } = byPeriod[period];
    return !Number.isInteger(total)
      || !Number.isInteger(settled)
      || total <= 0
      || settled !== total
      || missing !== 0;
  });

  if (invalid) {
    throw new Error(`LOCAL_MARKET_EXACTA_PAYOUT_COVERAGE_INCOMPLETE ${JSON.stringify(byPeriod)}`);
  }
} finally {
  db.close();
}

await import("./analyze-local-market-anomalies.ts");

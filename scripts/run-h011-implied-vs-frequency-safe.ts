/**
 * Fail-closed launcher for analyze-h011-implied-vs-frequency.ts.
 * Historical closing-odds research only; does not connect to Current BUY, T-5, LINE, public, or betting behavior.
 */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { historicalExactaCanonicalSourcePredicate } from "../src/research-replay/historicalExactaMarketAuthority";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const EXCL_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES = [10, 11, 12];
const exclV = EXCL_VENUES.map(value => `'${value}'`).join(",");
const exclR = EXCL_RACES.join(",");

if (!existsSync(DB_PATH)) throw new Error(`H011_PRIMARY_DB_MISSING ${DB_PATH}`);
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "H011_PRIMARY_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000;");

type CoverageRow = { period: string; total: number; settled: number };

try {
  const coverage = db.prepare(`
    WITH population AS (
      SELECT hao.race_id, hao.race_date AS date,
        COUNT(*) AS combo_count,
        COALESCE((
          SELECT COUNT(*) FROM race_entries re
          WHERE re.race_id=hao.race_id AND re.status_code='F'
        ), 0) AS has_f
      FROM historical_alternative_odds hao
      INNER JOIN decision_history dh ON dh.race_id=hao.race_id
        AND dh.decision='BUY'
        AND dh.run_kind='historical-backfill'
        AND dh.result IS NOT NULL AND dh.result!=''
        AND dh.current_odds IS NOT NULL
        AND dh.selection='1-2-3'
        AND dh.venue NOT IN (${exclV})
        AND dh.race_no NOT IN (${exclR})
        AND dh.date>='2024-01-01'
      WHERE hao.bet_type='exacta'
        AND ${historicalExactaCanonicalSourcePredicate("hao")}
      GROUP BY hao.race_id
      HAVING COUNT(*)=30 AND has_f=0
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
    SELECT CASE WHEN p.date<'2025-01-01' THEN 'heldout' ELSE 'forward' END AS period,
      COUNT(*) AS total,
      SUM(COALESCE(s.settled,0)) AS settled
    FROM population p
    LEFT JOIN settlement s ON s.race_id=p.race_id
    GROUP BY period
    ORDER BY period
  `).all() as CoverageRow[];

  const byPeriod = Object.fromEntries(["heldout", "forward"].map(period => {
    const row = coverage.find(candidate => candidate.period === period);
    const total = Number(row?.total ?? 0);
    const settled = Number(row?.settled ?? 0);
    return [period, { total, settled, missing: total - settled }];
  }));

  const invalid = ["heldout", "forward"].some(period => {
    const { total, settled, missing } = byPeriod[period];
    return !Number.isInteger(total)
      || !Number.isInteger(settled)
      || total <= 0
      || settled !== total
      || missing !== 0;
  });

  if (invalid) {
    throw new Error(`H011_EXACTA_PAYOUT_COVERAGE_INCOMPLETE ${JSON.stringify(byPeriod)}`);
  }
} finally {
  db.close();
}

await import("./analyze-h011-implied-vs-frequency");

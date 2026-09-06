import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const MODEL = "boatpon-v3-alpha15";
const BOUNDARY = "2025-01-01";

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

try {
  const rows = db.prepare(`
    WITH population AS (
      SELECT
        CASE WHEN date < ? THEN 'train' ELSE 'forward' END AS period,
        result,
        selection,
        payout_yen
      FROM decision_history
      WHERE decision='BUY'
        AND run_kind='historical-backfill'
        AND model_version=?
        AND bet_type='3連単'
        AND result IS NOT NULL
        AND result!=''
        AND returned=0
        AND current_odds IS NOT NULL
    )
    SELECT
      period,
      COUNT(*) AS total,
      SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) AS hits,
      SUM(CASE WHEN result=selection AND payout_yen IS NOT NULL AND payout_yen > 0 THEN 1 ELSE 0 END) AS settled_hits
    FROM population
    GROUP BY period
    ORDER BY period
  `).all(BOUNDARY, MODEL) as Array<{
    period: string;
    total: number;
    hits: number;
    settled_hits: number;
  }>;

  const byPeriod = Object.fromEntries(["train", "forward"].map((period) => {
    const row = rows.find((candidate) => candidate.period === period);
    const total = Number(row?.total ?? 0);
    const hits = Number(row?.hits ?? 0);
    const settledHits = Number(row?.settled_hits ?? 0);
    return [period, { total, hits, settledHits, missingHitPayouts: hits - settledHits }];
  }));

  console.log(JSON.stringify({ model: MODEL, boundary: BOUNDARY, byPeriod }));

  const invalid = ["train", "forward"].some((period) => {
    const { total, hits, settledHits, missingHitPayouts } = byPeriod[period];
    return !Number.isInteger(total)
      || !Number.isInteger(hits)
      || !Number.isInteger(settledHits)
      || total <= 0
      || hits <= 0
      || settledHits !== hits
      || missingHitPayouts !== 0;
  });

  if (invalid) {
    console.error(`CALIBRATION_STABILITY_PAYOUT_COVERAGE_INCOMPLETE ${JSON.stringify(byPeriod)}`);
    process.exitCode = 2;
  }
} finally {
  db.close();
}

import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const MODEL = "boatpon-v3-alpha15";
const BOUNDARY = "2025-01-01";

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

try {
  const blankResult = db.prepare(`
    SELECT COUNT(*) AS invalid
    FROM decision_history
    WHERE decision='BUY'
      AND run_kind='historical-backfill'
      AND model_version=?
      AND bet_type='3連単'
      AND result IS NOT NULL
      AND TRIM(result)=''
      AND current_odds IS NOT NULL
  `).get(MODEL) as { invalid: number };

  if (Number(blankResult.invalid) > 0) {
    throw new Error(`CALIBRATION_STABILITY_BLANK_SETTLED_RESULT_UNSUPPORTED ${JSON.stringify({ invalid: Number(blankResult.invalid) })}`);
  }

  const invalidReturn = db.prepare(`
    SELECT COUNT(*) AS invalid
    FROM decision_history
    WHERE decision='BUY'
      AND run_kind='historical-backfill'
      AND model_version=?
      AND bet_type='3連単'
      AND result IS NOT NULL
      AND TRIM(result)!=''
      AND current_odds IS NOT NULL
      AND (returned IS NULL OR returned != 0)
  `).get(MODEL) as { invalid: number };

  if (Number(invalidReturn.invalid) > 0) {
    throw new Error(`CALIBRATION_STABILITY_RETURN_STATE_INVALID ${JSON.stringify({ invalid: Number(invalidReturn.invalid) })}`);
  }

  const duplicateOrInvalid = db.prepare(`
    WITH winners AS (
      SELECT DISTINCT race_id, selection
      FROM decision_history
      WHERE decision='BUY'
        AND run_kind='historical-backfill'
        AND model_version=?
        AND bet_type='3連単'
        AND result IS NOT NULL AND TRIM(result)!=''
        AND returned=0
        AND current_odds IS NOT NULL
        AND selection=result
    ), exact_settlements AS (
      SELECT
        w.race_id,
        w.selection,
        COUNT(rp.race_id) AS total_rows,
        SUM(CASE WHEN rp.returned=0 AND rp.payout_yen IS NOT NULL AND rp.payout_yen>0 THEN 1 ELSE 0 END) AS valid_rows
      FROM winners w
      LEFT JOIN race_payouts rp
        ON rp.race_id=w.race_id
       AND rp.bet_type='trifecta'
       AND rp.combination=w.selection
      GROUP BY w.race_id, w.selection
    )
    SELECT COUNT(*) AS invalid
    FROM exact_settlements
    WHERE total_rows != 1 OR valid_rows != 1
  `).get(MODEL) as { invalid: number };

  if (Number(duplicateOrInvalid.invalid) > 0) {
    console.error(`CALIBRATION_STABILITY_OFFICIAL_SETTLEMENT_INVALID ${JSON.stringify({ invalid: Number(duplicateOrInvalid.invalid) })}`);
    process.exitCode = 2;
  } else {
    const rows = db.prepare(`
      WITH population AS (
        SELECT
          CASE WHEN dh.date < ? THEN 'train' ELSE 'forward' END AS period,
          dh.result,
          dh.selection,
          CASE WHEN dh.result=dh.selection THEN (
            SELECT rp.payout_yen
            FROM race_payouts rp
            WHERE rp.race_id=dh.race_id
              AND rp.bet_type='trifecta'
              AND rp.combination=dh.selection
              AND rp.returned=0
              AND rp.payout_yen>0
            LIMIT 1
          ) ELSE 0 END AS payout_yen
        FROM decision_history dh
        WHERE dh.decision='BUY'
          AND dh.run_kind='historical-backfill'
          AND dh.model_version=?
          AND dh.bet_type='3連単'
          AND dh.result IS NOT NULL
          AND TRIM(dh.result)!=''
          AND dh.returned=0
          AND dh.current_odds IS NOT NULL
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

    console.log(JSON.stringify({ model: MODEL, boundary: BOUNDARY, payoutBasis: "official-race_payouts", byPeriod }));

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
  }
} finally {
  db.close();
}
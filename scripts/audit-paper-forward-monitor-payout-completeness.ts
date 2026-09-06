/**
 * audit-paper-forward-monitor-payout-completeness.ts — research-only/read-only
 *
 * The paper-forward monitor compares train and forward slices of the historical
 * 1-2-3 BUY population and also computes counterfactual 1-3-2 payout ROI. Require
 * one positive official trifecta settlement for every race in that union before
 * any payout-derived monitor verdict can be emitted.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { evaluatePaperForwardPayoutCompleteness } from "../src/research-replay/paperForwardPayoutCompleteness";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const EXCLUDED_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACES = [10, 11, 12];

if (!existsSync(DB_PATH)) {
  console.error("[paper-forward-monitor-payout-preflight] database not found");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "paper-forward monitor primary database");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

type CoverageRow = { total: number; covered: number };
const excludedVenues = EXCLUDED_VENUES.map((venue) => `'${venue}'`).join(",");
const excludedRaces = EXCLUDED_RACES.join(",");

const row = db.prepare(`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN EXISTS (
      SELECT 1
      FROM race_payouts rp
      WHERE rp.race_id = dh.race_id
        AND rp.bet_type = 'trifecta'
        AND rp.payout_yen IS NOT NULL
        AND rp.payout_yen > 0
    ) THEN 1 ELSE 0 END) AS covered
  FROM decision_history dh
  WHERE dh.decision = 'BUY'
    AND dh.run_kind = 'historical-backfill'
    AND dh.result IS NOT NULL
    AND dh.result != ''
    AND dh.venue NOT IN (${excludedVenues})
    AND dh.race_no NOT IN (${excludedRaces})
    AND dh.selection = '1-2-3'
`).get() as CoverageRow;

const result = evaluatePaperForwardPayoutCompleteness(row.total ?? 0, row.covered ?? 0);
db.close();

console.log(
  `[paper-forward-monitor-payout-preflight] covered=${result.coveredRaces}/${result.totalRaces} (${result.coverageRate}%) missing=${result.missingRaces}`,
);

if (!result.complete) {
  console.error("[paper-forward-monitor-payout-preflight] PAPER_FORWARD_MONITOR_EXACTA_PAYOUT_COVERAGE_INCOMPLETE: official trifecta settlement coverage is incomplete; monitor payout ROI/trend/verdicts must remain unavailable");
  process.exit(2);
}

console.log("[paper-forward-monitor-payout-preflight] PASS: official trifecta settlement coverage is complete for the monitor population");

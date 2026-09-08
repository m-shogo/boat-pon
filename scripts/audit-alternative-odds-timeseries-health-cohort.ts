/**
 * audit-alternative-odds-timeseries-health-cohort.ts — research-only/read-only
 *
 * Fail closed before any alternative-odds T-5/T-10/T-20/T-30 coverage or
 * readiness counts are generated. This preflight emits no counts or odds.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const FORWARD_START = "2025-01-01";
const EXCLUDED_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACES = [10, 11, 12];

if (!existsSync(DB_PATH)) {
  console.error("[alternative-odds-health-cohort] research database unavailable");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "alternative odds timeseries health primary database",
);
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

const excludedVenues = EXCLUDED_VENUES.map((venue) => `'${venue}'`).join(",");
const excludedRaces = EXCLUDED_RACES.join(",");
const TARGET_SCOPE = `
  dh.decision='BUY'
  AND dh.run_kind='historical-backfill'
  AND dh.result IS NOT NULL
  AND dh.result != ''
  AND dh.venue NOT IN (${excludedVenues})
  AND dh.race_no NOT IN (${excludedRaces})
  AND dh.selection='1-2-3'
  AND dh.date >= '${FORWARD_START}'
`;

const invalidCohort = db.prepare(`
  SELECT 1
  FROM decision_history dh
  WHERE ${TARGET_SCOPE}
    AND (
      dh.bet_type IS NULL
      OR dh.bet_type != '3連単'
      OR dh.returned IS NULL
      OR dh.returned != 0
    )
  LIMIT 1
`).get();

if (invalidCohort) {
  db.close();
  console.error("[alternative-odds-health-cohort] FAIL CLOSED: forward BUY cohort contains unsupported bet type or returned/unknown-return rows");
  process.exit(2);
}

const duplicateRace = db.prepare(`
  SELECT 1
  FROM decision_history dh
  WHERE ${TARGET_SCOPE}
    AND dh.bet_type='3連単'
    AND dh.returned=0
  GROUP BY dh.race_id
  HAVING COUNT(*) != 1
  LIMIT 1
`).get();

db.close();

if (duplicateRace) {
  console.error("[alternative-odds-health-cohort] FAIL CLOSED: settled trifecta forward BUY cohort is not unique by race_id");
  process.exit(2);
}

console.log("[alternative-odds-health-cohort] PASS: canonical settled trifecta forward cohort verified");

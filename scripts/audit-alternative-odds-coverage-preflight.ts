/**
 * audit-alternative-odds-coverage-preflight.ts — research-only/read-only
 *
 * Fail closed before the historical alternative-odds coverage report interprets
 * its forward BUY population. This preflight intentionally emits no population
 * counts or odds values.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const FORWARD_START = "2025-01-01";
const EXCLUDED_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACES = [10, 11, 12];

if (!existsSync(DB_PATH)) {
  console.error("[alternative-odds-coverage-preflight] database not found");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "alternative odds coverage primary database",
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
  AND dh.current_odds IS NOT NULL
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
  console.error("[alternative-odds-coverage-preflight] FAIL CLOSED: historical forward cohort contains unsupported bet type or returned/unknown-return rows");
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
  console.error("[alternative-odds-coverage-preflight] FAIL CLOSED: historical forward cohort is not unique by race_id");
  process.exit(2);
}

console.log("[alternative-odds-coverage-preflight] PASS: canonical settled trifecta forward cohort verified");

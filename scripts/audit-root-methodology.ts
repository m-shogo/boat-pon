/**
 * Guarded entrypoint for the root methodology audit.
 *
 * The report intentionally compares several distinct cohorts, but the
 * historical governor-forward cohort must remain the canonical settled
 * trifecta population. Validate that population before loading the existing
 * read-only methodology implementation.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const EXCL_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];

if (!existsSync(DB_PATH)) throw new Error("ROOT_METHODOLOGY_RESEARCH_DB_UNAVAILABLE");

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "ROOT_METHODOLOGY_PRIMARY_DB_IDENTITY_INVALID",
);
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");

const blankHistoricalResults = db.prepare(`
  SELECT COUNT(*) AS invalid
  FROM decision_history dh
  WHERE dh.decision='BUY'
    AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL
    AND TRIM(dh.result)=''
`).get() as { invalid: number };

if (Number(blankHistoricalResults.invalid ?? 0) > 0) {
  db.close();
  throw new Error("ROOT_METHODOLOGY_BLANK_HISTORICAL_RESULT_UNSUPPORTED");
}

const venuePlaceholders = EXCL_VENUES.map(() => "?").join(",");
const invalidForwardCohort = db.prepare(`
  SELECT COUNT(*) AS invalid
  FROM decision_history dh
  WHERE dh.decision='BUY'
    AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result!=''
    AND dh.current_odds IS NOT NULL
    AND dh.selection='1-2-3'
    AND dh.date >= '2025-01-01'
    AND dh.venue NOT IN (${venuePlaceholders})
    AND dh.race_no NOT IN (10,11,12)
    AND (
      dh.bet_type IS NULL OR dh.bet_type != '3連単'
      OR dh.returned IS NULL OR dh.returned != 0
    )
`).get(...EXCL_VENUES) as { invalid: number };

if (Number(invalidForwardCohort.invalid ?? 0) > 0) {
  db.close();
  throw new Error("ROOT_METHODOLOGY_FORWARD_COHORT_INVALID");
}

db.close();
process.env.BOAT_PON_DB_PATH = verifiedDbPath;
await import("./audit-root-methodology-internal");
/**
 * Guarded entrypoint for historical alternative-odds quality checks.
 *
 * The quality report's forward/backfill denominators depend on a historical
 * BUY cohort. Validate that cohort and canonical DB identity before loading
 * the existing read-only implementation.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const EXCL_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES = [10, 11, 12];

if (!existsSync(DB_PATH)) {
  console.error("[historical-alt-odds-quality] research database unavailable");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "HISTORICAL_ALT_ODDS_QUALITY_DB_IDENTITY_INVALID",
);
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

const placeholdersV = EXCL_VENUES.map(() => "?").join(",");
const placeholdersR = EXCL_RACES.map(() => "?").join(",");
const invalidForwardCohort = db.prepare(`
  SELECT COUNT(*) AS invalid
  FROM decision_history dh
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result != ''
    AND dh.current_odds IS NOT NULL
    AND dh.selection='1-2-3'
    AND dh.date >= '2025-01-01'
    AND dh.venue NOT IN (${placeholdersV})
    AND dh.race_no NOT IN (${placeholdersR})
    AND (
      dh.bet_type IS NULL OR dh.bet_type != '3連単'
      OR dh.returned IS NULL OR dh.returned != 0
    )
`).get(...EXCL_VENUES, ...EXCL_RACES) as { invalid: number };

if (Number(invalidForwardCohort.invalid ?? 0) > 0) {
  db.close();
  throw new Error("HISTORICAL_ALT_ODDS_QUALITY_DECISION_COHORT_INVALID");
}

db.close();
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  verifiedDbPath,
  "HISTORICAL_ALT_ODDS_QUALITY_DB_HANDOFF_IDENTITY_INVALID",
);
process.env.BOAT_PON_DB_PATH = handoffDbPath;
await import("./check-historical-alternative-odds-quality-internal");
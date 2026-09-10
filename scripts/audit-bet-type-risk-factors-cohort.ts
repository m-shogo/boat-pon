/**
 * audit-bet-type-risk-factors-cohort.ts — research-only/read-only preflight
 *
 * The risk-factor analysis parses a three-boat selection and counterfactually
 * prices trifecta/trio/exacta/quinella outcomes. It is valid only for canonical
 * settled 3連単 historical BUY rows, unique by race. Emit no population counts.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";

if (!existsSync(DB_PATH)) {
  console.error("[bet-type-risk-cohort] database not found");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "bet type risk primary database",
);
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON;");
db.exec("PRAGMA busy_timeout = 5000;");
// Keep shape and uniqueness checks on one append-only research snapshot.
db.exec("BEGIN;");

const invalid = db.prepare(`
  SELECT 1
  FROM decision_history dh
  WHERE dh.decision='BUY'
    AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL
    AND dh.result != ''
    AND (
      dh.bet_type IS NULL
      OR dh.bet_type != '3連単'
      OR dh.returned IS NULL
      OR dh.returned != 0
      OR length(dh.selection) != 5
      OR dh.selection NOT GLOB '[1-6]-[1-6]-[1-6]'
      OR substr(dh.selection, 1, 1) = substr(dh.selection, 3, 1)
      OR substr(dh.selection, 1, 1) = substr(dh.selection, 5, 1)
      OR substr(dh.selection, 3, 1) = substr(dh.selection, 5, 1)
    )
  LIMIT 1
`).get();

if (invalid) {
  db.close();
  console.error("[bet-type-risk-cohort] FAIL CLOSED: historical BUY cohort contains unsupported bet type, returned/unknown-return rows, or malformed three-boat selection");
  process.exit(2);
}

const duplicateRace = db.prepare(`
  SELECT 1
  FROM decision_history dh
  WHERE dh.decision='BUY'
    AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL
    AND dh.result != ''
    AND dh.bet_type='3連単'
    AND dh.returned=0
  GROUP BY dh.race_id
  HAVING COUNT(*) != 1
  LIMIT 1
`).get();

db.close();

if (duplicateRace) {
  console.error("[bet-type-risk-cohort] FAIL CLOSED: historical settled trifecta BUY cohort is not unique by race_id");
  process.exit(2);
}

console.log("[bet-type-risk-cohort] PASS: canonical settled trifecta historical BUY cohort verified");

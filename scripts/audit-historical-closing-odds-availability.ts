/**
 * Guarded entrypoint for the historical closing-odds availability audit.
 *
 * This launcher validates the canonical research DB and the historical BUY
 * cohort before any archive/cache access is allowed. The implementation is
 * kept in an internal module so direct use of the documented entrypoint is
 * fail-closed.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";

if (!existsSync(DB_PATH)) {
  console.error("[historical-closing-odds-audit] research database unavailable");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "HISTORICAL_CLOSING_ODDS_AUDIT_DB_IDENTITY_INVALID",
);

const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

const invalidCohort = db.prepare(`
  SELECT COUNT(*) AS invalid
  FROM decision_history dh
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.selection='1-2-3'
    AND dh.result IS NOT NULL AND dh.result != ''
    AND dh.current_odds IS NOT NULL
    AND dh.date >= '2025-01-01'
    AND (
      dh.bet_type IS NULL OR dh.bet_type != '3連単'
      OR dh.returned IS NULL OR dh.returned != 0
    )
`).get() as { invalid: number };

if (Number(invalidCohort.invalid ?? 0) > 0) {
  db.close();
  throw new Error("HISTORICAL_CLOSING_ODDS_AUDIT_DECISION_COHORT_INVALID");
}

db.close();

const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  verifiedDbPath,
  "HISTORICAL_CLOSING_ODDS_AUDIT_DB_HANDOFF_IDENTITY_INVALID",
);

// Keep the implementation read-only and force it to use the re-verified canonical path.
process.env.BOAT_PON_DB_PATH = handoffDbPath;
await import("./audit-historical-closing-odds-availability-internal");

/** Read-only fail-closed integrity preflight for Research Governor readiness counts. */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";
import {
  historicalTrifectaCanonicalSourcePredicate,
  historicalTrifectaCompleteMarketPredicate,
} from "../src/research-replay/historicalTrifectaMarketAuthority";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(DB_PATH)) throw new Error("RESEARCH_GOVERNOR_DB_UNAVAILABLE");
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_GOVERNOR_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

const EXCL_V = `'戸田','多摩川','桐生','三国','江戸川'`;
const EXCL_R = "10,11,12";
const baseWhere = `
  dh.decision='BUY' AND dh.run_kind='historical-backfill'
  AND dh.result IS NOT NULL AND dh.result != ''
  AND dh.current_odds IS NOT NULL
  AND dh.venue NOT IN (${EXCL_V})
  AND dh.race_no NOT IN (${EXCL_R})
  AND dh.selection='1-2-3'
  AND dh.date >= '2025-01-01'`;

try {
  const drift = db.prepare(`
    SELECT COUNT(*) AS n
    FROM decision_history dh
    WHERE ${baseWhere}
      AND (dh.bet_type IS NULL OR dh.bet_type != '3連単' OR dh.returned IS NULL OR dh.returned != 0)
  `).get() as { n: number };
  if ((drift.n ?? 0) > 0) throw new Error("RESEARCH_GOVERNOR_DECISION_COHORT_INVALID");

  const misleadingCoverage = db.prepare(`
    SELECT COUNT(DISTINCT dh.race_id) AS n
    FROM decision_history dh
    WHERE ${baseWhere}
      AND EXISTS (
        SELECT 1 FROM historical_alternative_odds hao
        WHERE hao.race_id=dh.race_id AND hao.source_quality='historical_closing_odds'
      )
      AND NOT EXISTS (
        SELECT 1 FROM historical_alternative_odds h
        WHERE h.race_id=dh.race_id
          AND h.bet_type='trifecta'
          AND ${historicalTrifectaCanonicalSourcePredicate("h")}
          AND ${historicalTrifectaCompleteMarketPredicate("h.race_id")}
      )
  `).get() as { n: number };
  if ((misleadingCoverage.n ?? 0) > 0) throw new Error("RESEARCH_GOVERNOR_TRIFECTA_COVERAGE_INVALID");

  console.log("[research-governor-preflight] PASS: forward BUY cohort and historical trifecta readiness coverage are canonical");
} finally {
  db.close();
}

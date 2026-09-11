import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-pattern-search.md";
const OUT_JSON = "reports/roi-pattern-search.json";
const DECISION_BET_TYPE = "3連単";
const PAYOUT_BET_TYPE = "trifecta";

function assertExistingOutputIdentity(path: string, code: string): void {
  if (!existsSync(path)) return;
  assertCanonicalSingleLinkRegularFile(path, code);
}

function assertGeneratedOutputIdentity(path: string, missingCode: string, invalidCode: string): void {
  if (!existsSync(path)) throw new Error(missingCode);
  assertCanonicalSingleLinkRegularFile(path, invalidCode);
}

if (!existsSync(DB_PATH)) {
  console.error("[search-roi-patterns] database not found");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "roi-pattern-search primary database identity mismatch");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

try {
  const invalidReturn = db.prepare(`
SELECT COUNT(*) AS n
FROM decision_history dh
WHERE dh.run_kind = 'historical-backfill'
  AND dh.decision = 'BUY'
  AND dh.bet_type = ?
  AND dh.current_odds IS NOT NULL
  AND dh.result IS NOT NULL
  AND dh.result != ''
  AND (dh.returned IS NULL OR dh.returned != 0)
`).get(DECISION_BET_TYPE) as { n: number };

  if ((invalidReturn.n ?? 0) > 0) {
    console.error(`[search-roi-patterns] FAIL CLOSED: ${invalidReturn.n} historical BUY row(s) have unknown or returned settlement state`);
    process.exit(2);
  }

  const integrity = db.prepare(`
WITH relevant_settled AS (
  SELECT DISTINCT dh.race_id, dh.result
  FROM decision_history dh
  WHERE dh.run_kind = 'historical-backfill'
    AND dh.decision = 'BUY'
    AND dh.bet_type = ?
    AND dh.current_odds IS NOT NULL
    AND dh.result IS NOT NULL
    AND dh.result != ''
    AND dh.returned = 0
), invalid AS (
  SELECT s.race_id, s.result
  FROM relevant_settled s
  WHERE (
    SELECT COUNT(*)
    FROM race_payouts rp
    WHERE rp.race_id = s.race_id
      AND rp.bet_type = ?
      AND rp.combination = s.result
  ) != 1
  OR (
    SELECT COUNT(*)
    FROM race_payouts rp
    WHERE rp.race_id = s.race_id
      AND rp.bet_type = ?
      AND rp.combination = s.result
      AND rp.returned = 0
      AND rp.payout_yen IS NOT NULL
      AND rp.payout_yen > 0
  ) != 1
)
SELECT COUNT(*) AS n FROM invalid
`).get(DECISION_BET_TYPE, PAYOUT_BET_TYPE, PAYOUT_BET_TYPE) as { n: number };

  if ((integrity.n ?? 0) > 0) {
    console.error(`[search-roi-patterns] FAIL CLOSED: ${integrity.n} settled denominator race(s) do not have exactly one positive non-refund official winning settlement`);
    process.exit(2);
  }
} finally {
  db.close();
}

const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  verifiedDbPath,
  "ROI_PATTERN_DB_HANDOFF_IDENTITY_INVALID",
);
process.env.BOAT_PON_DB_PATH = handoffDbPath;

assertExistingOutputIdentity(OUT_MD, "ROI_PATTERN_MD_PREEXISTING_IDENTITY_INVALID");
assertExistingOutputIdentity(OUT_JSON, "ROI_PATTERN_JSON_PREEXISTING_IDENTITY_INVALID");

const childDbPath = assertCanonicalSingleLinkRegularFile(
  handoffDbPath,
  "ROI_PATTERN_DB_CHILD_HANDOFF_IDENTITY_INVALID",
);
process.env.BOAT_PON_DB_PATH = childDbPath;
await import("./search-roi-patterns-internal");

assertGeneratedOutputIdentity(
  OUT_MD,
  "ROI_PATTERN_MD_OUTPUT_MISSING",
  "ROI_PATTERN_MD_OUTPUT_IDENTITY_INVALID",
);
assertGeneratedOutputIdentity(
  OUT_JSON,
  "ROI_PATTERN_JSON_OUTPUT_MISSING",
  "ROI_PATTERN_JSON_OUTPUT_IDENTITY_INVALID",
);

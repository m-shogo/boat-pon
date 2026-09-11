/**
 * Guarded entrypoint for the historical exacta backfill quality audit.
 *
 * Validates canonical research DB identity and the historical BUY target cohort
 * before loading the existing read-only quality implementation.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/exacta-backfill-quality.md";
const OUT_JSON = "reports/exacta-backfill-quality.json";
const EXCL_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES = [10, 11, 12];

function assertExistingOutputIdentity(path: string, code: string): void {
  if (!existsSync(path)) return;
  assertCanonicalSingleLinkRegularFile(path, code);
}

function assertGeneratedOutputIdentity(path: string, missingCode: string, invalidCode: string): void {
  if (!existsSync(path)) throw new Error(missingCode);
  assertCanonicalSingleLinkRegularFile(path, invalidCode);
}

if (!existsSync(DB_PATH)) {
  console.error("[exacta-backfill-quality] research database unavailable");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "EXACTA_BACKFILL_QUALITY_DB_IDENTITY_INVALID",
);
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

const placeholdersV = EXCL_VENUES.map(() => "?").join(",");
const placeholdersR = EXCL_RACES.map(() => "?").join(",");
const invalidTargetCohort = db.prepare(`
  SELECT COUNT(*) AS invalid
  FROM decision_history dh
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result != ''
    AND dh.current_odds IS NOT NULL
    AND dh.selection='1-2-3'
    AND dh.venue NOT IN (${placeholdersV})
    AND dh.race_no NOT IN (${placeholdersR})
    AND dh.date >= '2024-01-01'
    AND (
      dh.bet_type IS NULL OR dh.bet_type != '3連単'
      OR dh.returned IS NULL OR dh.returned != 0
    )
`).get(...EXCL_VENUES, ...EXCL_RACES) as { invalid: number };

if (Number(invalidTargetCohort.invalid ?? 0) > 0) {
  db.close();
  throw new Error("EXACTA_BACKFILL_QUALITY_DECISION_COHORT_INVALID");
}

db.close();
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  verifiedDbPath,
  "EXACTA_BACKFILL_QUALITY_DB_HANDOFF_IDENTITY_INVALID",
);
process.env.BOAT_PON_DB_PATH = handoffDbPath;

assertExistingOutputIdentity(OUT_MD, "EXACTA_BACKFILL_QUALITY_MD_PREEXISTING_IDENTITY_INVALID");
assertExistingOutputIdentity(OUT_JSON, "EXACTA_BACKFILL_QUALITY_JSON_PREEXISTING_IDENTITY_INVALID");

const childDbPath = assertCanonicalSingleLinkRegularFile(
  handoffDbPath,
  "EXACTA_BACKFILL_QUALITY_DB_CHILD_HANDOFF_IDENTITY_INVALID",
);
process.env.BOAT_PON_DB_PATH = childDbPath;
await import("./check-exacta-backfill-quality-internal");

assertGeneratedOutputIdentity(
  OUT_MD,
  "EXACTA_BACKFILL_QUALITY_MD_OUTPUT_MISSING",
  "EXACTA_BACKFILL_QUALITY_MD_OUTPUT_IDENTITY_INVALID",
);
assertGeneratedOutputIdentity(
  OUT_JSON,
  "EXACTA_BACKFILL_QUALITY_JSON_OUTPUT_MISSING",
  "EXACTA_BACKFILL_QUALITY_JSON_OUTPUT_IDENTITY_INVALID",
);

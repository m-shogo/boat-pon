import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/check-historical-alternative-odds-quality.ts", "utf8");
const internal = readFileSync("scripts/check-historical-alternative-odds-quality-internal.ts", "utf8");

test("historical alternative-odds quality entrypoint verifies canonical read-only DB without path disclosure", () => {
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile/u);
  assert.match(entrypoint, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(entrypoint, /PRAGMA query_only\s*=\s*ON/u);
  assert.match(entrypoint, /research database unavailable/u);
  assert.doesNotMatch(entrypoint, /DB not found: \$\{DB_PATH\}/u);
});

test("historical alternative-odds quality rejects forward cohort drift and reverifies DB identity before report implementation", () => {
  assert.match(entrypoint, /dh\.bet_type IS NULL OR dh\.bet_type != '3連単'/u);
  assert.match(entrypoint, /dh\.returned IS NULL OR dh\.returned != 0/u);
  assert.match(entrypoint, /dh\.date >= '2025-01-01'/u);
  assert.match(entrypoint, /HISTORICAL_ALT_ODDS_QUALITY_DECISION_COHORT_INVALID/u);
  assert.match(entrypoint, /HISTORICAL_ALT_ODDS_QUALITY_DB_HANDOFF_IDENTITY_INVALID/u);

  const guard = entrypoint.indexOf("const invalidForwardCohort = db.prepare");
  const failure = entrypoint.indexOf("HISTORICAL_ALT_ODDS_QUALITY_DECISION_COHORT_INVALID");
  const close = entrypoint.indexOf("db.close();", failure);
  const handoff = entrypoint.indexOf("const handoffDbPath = assertCanonicalSingleLinkRegularFile", close);
  const envHandoff = entrypoint.indexOf("process.env.BOAT_PON_DB_PATH = handoffDbPath", handoff);
  const implementationImport = entrypoint.indexOf("check-historical-alternative-odds-quality-internal");
  assert.ok(guard >= 0, "forward cohort guard must exist");
  assert.ok(failure > guard, "cohort failure contract must follow the query");
  assert.ok(close > failure, "preflight DB must close before handoff identity revalidation");
  assert.ok(handoff > close, "DB identity must be revalidated after preflight closes");
  assert.ok(envHandoff > handoff, "only the reverified handoff path may be exported");
  assert.ok(implementationImport > envHandoff, "quality implementation must load only after handoff revalidation");
});

test("historical alternative-odds quality implementation remains read-only research", () => {
  assert.match(internal, /new DatabaseSync\(DB_PATH, \{ readOnly: true \}\)/u);
  assert.match(internal, /historical_alternative_odds/u);
  assert.match(internal, /run_kind='historical-backfill'/u);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\([^)]*(?:INSERT|UPDATE|DELETE|DROP|ALTER)/iu);
});
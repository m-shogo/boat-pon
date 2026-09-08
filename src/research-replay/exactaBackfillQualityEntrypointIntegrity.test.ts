import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/check-exacta-backfill-quality.ts", "utf8");
const internal = readFileSync("scripts/check-exacta-backfill-quality-internal.ts", "utf8");

test("exacta backfill quality entrypoint verifies canonical read-only DB without path disclosure", () => {
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile/u);
  assert.match(entrypoint, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(entrypoint, /PRAGMA query_only\s*=\s*ON/u);
  assert.match(entrypoint, /research database unavailable/u);
  assert.doesNotMatch(entrypoint, /DB not found: \$\{DB_PATH\}/u);
});

test("exacta backfill quality rejects decision cohort drift before implementation load", () => {
  assert.match(entrypoint, /dh\.bet_type IS NULL OR dh\.bet_type != '3連単'/u);
  assert.match(entrypoint, /dh\.returned IS NULL OR dh\.returned != 0/u);
  assert.match(entrypoint, /EXACTA_BACKFILL_QUALITY_DECISION_COHORT_INVALID/u);
  assert.match(entrypoint, /dh\.selection='1-2-3'/u);
  assert.match(entrypoint, /dh\.date >= '2024-01-01'/u);

  const guard = entrypoint.indexOf("const invalidTargetCohort = db.prepare");
  const failure = entrypoint.indexOf("EXACTA_BACKFILL_QUALITY_DECISION_COHORT_INVALID");
  const implementationImport = entrypoint.indexOf("check-exacta-backfill-quality-internal");
  assert.ok(guard >= 0, "target cohort guard must exist");
  assert.ok(failure > guard, "failure contract must follow cohort query");
  assert.ok(implementationImport > failure, "quality audit must load only after cohort validation");
});

test("exacta backfill quality implementation remains read-only historical research", () => {
  assert.match(internal, /new DatabaseSync\(DB_PATH, \{ readOnly: true \}\)/u);
  assert.match(internal, /historical_alternative_odds/u);
  assert.match(internal, /run_kind='historical-backfill'/u);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\([^)]*(?:INSERT|UPDATE|DELETE|DROP|ALTER)/iu);
});

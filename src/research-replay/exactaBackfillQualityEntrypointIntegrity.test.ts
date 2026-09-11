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

test("exacta backfill quality rejects decision cohort drift and protects report identities around implementation load", () => {
  assert.match(entrypoint, /dh\.bet_type IS NULL OR dh\.bet_type != '3連単'/u);
  assert.match(entrypoint, /dh\.returned IS NULL OR dh\.returned != 0/u);
  assert.match(entrypoint, /EXACTA_BACKFILL_QUALITY_DECISION_COHORT_INVALID/u);
  assert.match(entrypoint, /dh\.selection='1-2-3'/u);
  assert.match(entrypoint, /dh\.date >= '2024-01-01'/u);
  assert.match(entrypoint, /EXACTA_BACKFILL_QUALITY_DB_CHILD_HANDOFF_IDENTITY_INVALID/u);

  const guard = entrypoint.indexOf("const invalidTargetCohort = db.prepare");
  const failure = entrypoint.indexOf("EXACTA_BACKFILL_QUALITY_DECISION_COHORT_INVALID");
  const close = entrypoint.lastIndexOf("db.close()");
  const handoffIdentity = entrypoint.indexOf("EXACTA_BACKFILL_QUALITY_DB_HANDOFF_IDENTITY_INVALID");
  const mdPreexisting = entrypoint.indexOf("EXACTA_BACKFILL_QUALITY_MD_PREEXISTING_IDENTITY_INVALID", handoffIdentity);
  const jsonPreexisting = entrypoint.indexOf("EXACTA_BACKFILL_QUALITY_JSON_PREEXISTING_IDENTITY_INVALID", handoffIdentity);
  const childHandoffIdentity = entrypoint.indexOf("EXACTA_BACKFILL_QUALITY_DB_CHILD_HANDOFF_IDENTITY_INVALID", jsonPreexisting);
  const implementationImport = entrypoint.indexOf("check-exacta-backfill-quality-internal");
  const mdPostflight = entrypoint.indexOf("EXACTA_BACKFILL_QUALITY_MD_OUTPUT_IDENTITY_INVALID", implementationImport);
  const jsonPostflight = entrypoint.indexOf("EXACTA_BACKFILL_QUALITY_JSON_OUTPUT_IDENTITY_INVALID", implementationImport);
  assert.ok(guard >= 0, "target cohort guard must exist");
  assert.ok(failure > guard, "failure contract must follow cohort query");
  assert.ok(close > failure, "preflight DB must close after cohort validation");
  assert.ok(handoffIdentity > close, "DB identity must be reverified after preflight closes");
  assert.ok(mdPreexisting > handoffIdentity && jsonPreexisting > handoffIdentity, "existing report identities must be checked after DB handoff");
  assert.ok(childHandoffIdentity > mdPreexisting && childHandoffIdentity > jsonPreexisting, "DB identity must be reverified after output-path checks");
  assert.ok(implementationImport > childHandoffIdentity, "quality audit must load only after final handoff identity revalidation");
  assert.ok(mdPostflight > implementationImport && jsonPostflight > implementationImport, "generated report identities must be verified after implementation");
  assert.match(entrypoint, /BOAT_PON_DB_PATH = childDbPath/u);
  assert.match(entrypoint, /EXACTA_BACKFILL_QUALITY_MD_OUTPUT_MISSING/u);
  assert.match(entrypoint, /EXACTA_BACKFILL_QUALITY_JSON_OUTPUT_MISSING/u);
});

test("exacta backfill quality implementation remains read-only historical research", () => {
  assert.match(internal, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "EXACTA_BACKFILL_QUALITY_DB_IDENTITY_INVALID"\)/u);
  assert.match(internal, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(internal, /PRAGMA query_only\s*=\s*ON/u);
  assert.match(internal, /historical_alternative_odds/u);
  assert.match(internal, /run_kind='historical-backfill'/u);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\([^)]*(?:INSERT|UPDATE|DELETE|DROP|ALTER)/iu);
});

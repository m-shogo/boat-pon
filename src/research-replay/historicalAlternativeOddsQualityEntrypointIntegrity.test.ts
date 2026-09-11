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

test("historical alternative-odds quality rejects forward cohort drift and reverifies DB identity immediately before report implementation", () => {
  assert.match(entrypoint, /dh\.bet_type IS NULL OR dh\.bet_type != '3連単'/u);
  assert.match(entrypoint, /dh\.returned IS NULL OR dh\.returned != 0/u);
  assert.match(entrypoint, /dh\.date >= '2025-01-01'/u);
  assert.match(entrypoint, /HISTORICAL_ALT_ODDS_QUALITY_DECISION_COHORT_INVALID/u);
  assert.match(entrypoint, /HISTORICAL_ALT_ODDS_QUALITY_DB_HANDOFF_IDENTITY_INVALID/u);
  assert.match(entrypoint, /HISTORICAL_ALT_ODDS_QUALITY_DB_CHILD_HANDOFF_IDENTITY_INVALID/u);
  assert.match(entrypoint, /HISTORICAL_ALT_ODDS_QUALITY_DB_CHILD_LAUNCH_IDENTITY_INVALID/u);

  const guard = entrypoint.indexOf("const invalidForwardCohort = db.prepare");
  const failure = entrypoint.indexOf("HISTORICAL_ALT_ODDS_QUALITY_DECISION_COHORT_INVALID");
  const close = entrypoint.indexOf("db.close();", failure);
  const handoff = entrypoint.indexOf("const handoffDbPath = assertCanonicalSingleLinkRegularFile", close);
  const mdPreexisting = entrypoint.indexOf("HISTORICAL_ALT_ODDS_QUALITY_MD_PREEXISTING_IDENTITY_INVALID", handoff);
  const jsonPreexisting = entrypoint.indexOf("HISTORICAL_ALT_ODDS_QUALITY_JSON_PREEXISTING_IDENTITY_INVALID", handoff);
  const childHandoff = entrypoint.indexOf("HISTORICAL_ALT_ODDS_QUALITY_DB_CHILD_HANDOFF_IDENTITY_INVALID", jsonPreexisting);
  const workspace = entrypoint.indexOf("mkdtempSync(", childHandoff);
  const launchIdentity = entrypoint.indexOf("HISTORICAL_ALT_ODDS_QUALITY_DB_CHILD_LAUNCH_IDENTITY_INVALID", workspace);
  const childSpawn = entrypoint.indexOf("spawnSync(process.execPath", launchIdentity);
  const mdPostflight = entrypoint.indexOf("HISTORICAL_ALT_ODDS_QUALITY_MD_OUTPUT_IDENTITY_INVALID", childSpawn);
  const jsonPostflight = entrypoint.indexOf("HISTORICAL_ALT_ODDS_QUALITY_JSON_OUTPUT_IDENTITY_INVALID", childSpawn);
  assert.ok(guard >= 0, "forward cohort guard must exist");
  assert.ok(failure > guard, "cohort failure contract must follow the query");
  assert.ok(close > failure, "preflight DB must close before handoff identity revalidation");
  assert.ok(handoff > close, "DB identity must be revalidated after preflight closes");
  assert.ok(mdPreexisting > handoff && jsonPreexisting > handoff, "existing report paths must be verified after DB handoff");
  assert.ok(childHandoff > mdPreexisting && childHandoff > jsonPreexisting, "DB identity must be reverified after output-path checks");
  assert.ok(workspace > childHandoff, "isolated workspace must be created only after child DB handoff verification");
  assert.ok(launchIdentity > workspace, "DB identity must be reverified again immediately before child launch");
  assert.ok(childSpawn > launchIdentity, "isolated implementation must run only after launch-time DB identity verification");
  assert.ok(mdPostflight > childSpawn && jsonPostflight > childSpawn, "generated report identities must be verified after implementation");
  assert.match(entrypoint, /BOAT_PON_DB_PATH: launchDbPath/u);
  assert.doesNotMatch(entrypoint, /BOAT_PON_DB_PATH: childDbPath/u);
  assert.match(entrypoint, /HISTORICAL_ALT_ODDS_QUALITY_MD_OUTPUT_MISSING/u);
  assert.match(entrypoint, /HISTORICAL_ALT_ODDS_QUALITY_JSON_OUTPUT_MISSING/u);
});

test("historical alternative-odds quality implementation revalidates its DB and remains read-only research", () => {
  const identity = internal.indexOf("HISTORICAL_ALT_ODDS_QUALITY_INTERNAL_DB_IDENTITY_INVALID");
  const open = internal.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  const queryOnly = internal.indexOf("PRAGMA query_only = ON");
  assert.ok(identity >= 0, "internal DB identity guard must exist");
  assert.ok(open > identity, "internal DB must open only after identity verification");
  assert.ok(queryOnly > open, "query_only must be enabled after read-only open");
  assert.match(internal, /assertCanonicalSingleLinkRegularFile/u);
  assert.match(internal, /research database unavailable/u);
  assert.doesNotMatch(internal, /new DatabaseSync\(DB_PATH/u);
  assert.doesNotMatch(internal, /DB not found: \$\{DB_PATH\}/u);
  assert.match(internal, /historical_alternative_odds/u);
  assert.match(internal, /run_kind='historical-backfill'/u);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\([^)]*(?:INSERT|UPDATE|DELETE|DROP|ALTER)/iu);
});

test("historical alternative-odds quality isolates implementation writes and publishes verified outputs atomically", () => {
  assert.match(entrypoint, /mkdtempSync\(join\(tmpdir\(\), "boat-pon-historical-alt-quality-"\)\)/u);
  assert.match(entrypoint, /cwd: workspace/u);
  assert.match(entrypoint, /randomUUID/u);
  assert.match(entrypoint, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(entrypoint, /fsyncSync\(fd\)/u);
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(\s*tempPath,/u);
  assert.match(entrypoint, /renameSync\(verifiedTempPath, path\)/u);
  assert.match(entrypoint, /HISTORICAL_ALT_ODDS_QUALITY_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(entrypoint, /HISTORICAL_ALT_ODDS_QUALITY_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(entrypoint, /atomicPublish\(\s*OUT_MD,\s*markdown,/u);
  assert.match(entrypoint, /atomicPublish\(\s*OUT_JSON,\s*json,/u);
  assert.doesNotMatch(entrypoint, /await import\("\.\/check-historical-alternative-odds-quality-internal"\)/u);
});

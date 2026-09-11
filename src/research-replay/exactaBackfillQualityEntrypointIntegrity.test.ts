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

test("exacta backfill quality rejects decision cohort drift before isolated implementation handoff", () => {
  assert.match(entrypoint, /dh\.bet_type IS NULL OR dh\.bet_type != '3連単'/u);
  assert.match(entrypoint, /dh\.returned IS NULL OR dh\.returned != 0/u);
  assert.match(entrypoint, /EXACTA_BACKFILL_QUALITY_DECISION_COHORT_INVALID/u);
  assert.match(entrypoint, /dh\.selection='1-2-3'/u);
  assert.match(entrypoint, /dh\.date >= '2024-01-01'/u);
  assert.match(entrypoint, /EXACTA_BACKFILL_QUALITY_DB_CHILD_HANDOFF_IDENTITY_INVALID/u);
  assert.match(entrypoint, /EXACTA_BACKFILL_QUALITY_DB_CHILD_LAUNCH_IDENTITY_INVALID/u);

  const guard = entrypoint.indexOf("const invalidTargetCohort = db.prepare");
  const failure = entrypoint.indexOf("EXACTA_BACKFILL_QUALITY_DECISION_COHORT_INVALID");
  const close = entrypoint.lastIndexOf("db.close()");
  const handoffIdentity = entrypoint.indexOf("EXACTA_BACKFILL_QUALITY_DB_HANDOFF_IDENTITY_INVALID");
  const childHandoffIdentity = entrypoint.indexOf("EXACTA_BACKFILL_QUALITY_DB_CHILD_HANDOFF_IDENTITY_INVALID", handoffIdentity);
  const workspace = entrypoint.indexOf("mkdtempSync(", childHandoffIdentity);
  const launchIdentity = entrypoint.indexOf("EXACTA_BACKFILL_QUALITY_DB_CHILD_LAUNCH_IDENTITY_INVALID", workspace);
  const implementationSpawn = entrypoint.indexOf("const analysis = spawnSync", launchIdentity);
  assert.ok(guard >= 0, "target cohort guard must exist");
  assert.ok(failure > guard, "failure contract must follow cohort query");
  assert.ok(close > failure, "preflight DB must close after cohort validation");
  assert.ok(handoffIdentity > close, "DB identity must be reverified after preflight closes");
  assert.ok(childHandoffIdentity > handoffIdentity, "DB identity must be reverified at isolated child handoff");
  assert.ok(workspace > childHandoffIdentity, "workspace must be created only after child DB handoff verification");
  assert.ok(launchIdentity > workspace, "DB identity must be reverified again immediately before child launch");
  assert.ok(implementationSpawn > launchIdentity, "quality audit must start only after launch-time DB verification");
  assert.match(entrypoint, /BOAT_PON_DB_PATH: launchDbPath/u);
  assert.doesNotMatch(entrypoint, /BOAT_PON_DB_PATH: childDbPath/u);
  assert.doesNotMatch(entrypoint, /await import\("\.\/check-exacta-backfill-quality-internal"\)/u);
});

test("exacta backfill quality verifies isolated outputs, redacts DB provenance, and publishes atomically", () => {
  const implementationSpawn = entrypoint.indexOf("const analysis = spawnSync");
  const mdIdentity = entrypoint.indexOf("EXACTA_BACKFILL_QUALITY_MD_OUTPUT_IDENTITY_INVALID", implementationSpawn);
  const jsonIdentity = entrypoint.indexOf("EXACTA_BACKFILL_QUALITY_JSON_OUTPUT_IDENTITY_INVALID", implementationSpawn);
  const mdRead = entrypoint.indexOf('readFileSync(verifiedMdPath, "utf8")', mdIdentity);
  const jsonRead = entrypoint.indexOf('readFileSync(verifiedJsonPath, "utf8")', jsonIdentity);
  const redaction = entrypoint.indexOf('.split(launchDbPath).join("verified read-only research DB")', mdRead);
  const tempCreate = entrypoint.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = entrypoint.indexOf("fsyncSync(fd)", tempCreate);
  const tempIdentity = entrypoint.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, errorCode)", fsync);
  const rename = entrypoint.indexOf("renameSync(verifiedTempPath, path)", tempIdentity);
  const mdPublish = entrypoint.indexOf("EXACTA_BACKFILL_QUALITY_MD_PUBLISH_TEMP_IDENTITY_INVALID", mdRead);
  const jsonPublish = entrypoint.indexOf("EXACTA_BACKFILL_QUALITY_JSON_PUBLISH_TEMP_IDENTITY_INVALID", jsonRead);

  assert.ok(mdIdentity > implementationSpawn && jsonIdentity > implementationSpawn, "isolated outputs must be identity-verified after the child exits");
  assert.ok(mdRead > mdIdentity && jsonRead > jsonIdentity, "outputs must not be read before identity verification");
  assert.ok(redaction > mdRead, "private DB provenance must be redacted before publication");
  assert.ok(tempCreate >= 0 && fsync > tempCreate, "publication temp must be exclusively created and fsynced");
  assert.ok(tempIdentity > fsync && rename > tempIdentity, "only verified single-link temps may replace final reports");
  assert.ok(mdPublish > mdRead && jsonPublish > jsonRead, "both reports must publish through the atomic writer");
  assert.match(entrypoint, /EXACTA_BACKFILL_QUALITY_MD_OUTPUT_MISSING/u);
  assert.match(entrypoint, /EXACTA_BACKFILL_QUALITY_JSON_OUTPUT_MISSING/u);
  assert.match(entrypoint, /rmSync\(workspace, \{ recursive: true, force: true \}\)/u);
});

test("exacta backfill quality implementation remains read-only historical research", () => {
  assert.match(internal, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "EXACTA_BACKFILL_QUALITY_DB_IDENTITY_INVALID"\)/u);
  assert.match(internal, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(internal, /PRAGMA query_only\s*=\s*ON/u);
  assert.match(internal, /historical_alternative_odds/u);
  assert.match(internal, /run_kind='historical-backfill'/u);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\([^)]*(?:INSERT|UPDATE|DELETE|DROP|ALTER)/iu);
});

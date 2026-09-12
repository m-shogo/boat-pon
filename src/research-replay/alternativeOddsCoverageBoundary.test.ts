import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypoint = readFileSync("scripts/audit-alternative-odds-coverage.ts", "utf-8");
const preflight = readFileSync("scripts/audit-alternative-odds-coverage-preflight.ts", "utf-8");
const internal = readFileSync("scripts/audit-alternative-odds-coverage-internal.ts", "utf-8");

test("alternative odds coverage runs cohort preflight and DB launch revalidation before isolated aggregation", () => {
  const guard = entrypoint.indexOf('run("scripts/audit-alternative-odds-coverage-preflight.ts")');
  const handoffIdentity = entrypoint.indexOf("ALT_ODDS_COVERAGE_DB_HANDOFF_IDENTITY_INVALID");
  const workspace = entrypoint.indexOf("mkdtempSync(", handoffIdentity);
  const launchIdentity = entrypoint.indexOf("ALT_ODDS_COVERAGE_DB_CHILD_LAUNCH_IDENTITY_INVALID", workspace);
  const internalRun = entrypoint.indexOf("const audit = spawnSync", launchIdentity);
  assert.ok(guard >= 0, "entrypoint must invoke forward cohort preflight");
  assert.ok(handoffIdentity > guard, "database identity must be reverified after preflight");
  assert.ok(workspace > handoffIdentity, "internal coverage aggregation must use an isolated workspace");
  assert.ok(launchIdentity > workspace, "database identity must be reverified immediately before isolated child launch");
  assert.ok(internalRun > launchIdentity, "internal coverage aggregation must run only after launch revalidation");
  assert.match(entrypoint, /if \(preflight !== 0\)/);
  assert.match(entrypoint, /process\.exit\(preflight\)/);
  assert.match(entrypoint, /ALT_ODDS_COVERAGE_DB_MISSING/u);
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(\s*DB_PATH,/u);
  assert.match(entrypoint, /ALT_ODDS_COVERAGE_DB_CHILD_LAUNCH_IDENTITY_INVALID/u);
  assert.match(entrypoint, /cwd: workspace/u);
  assert.match(entrypoint, /BOAT_PON_DB_PATH: launchDbPath/u);
  assert.doesNotMatch(entrypoint, /BOAT_PON_DB_PATH: handoffDbPath/u);
});

test("alternative odds coverage verifies isolated outputs and publishes them atomically", () => {
  const internalRun = entrypoint.indexOf("const audit = spawnSync");
  const mdIdentity = entrypoint.indexOf("ALT_ODDS_COVERAGE_MD_OUTPUT_IDENTITY_INVALID", internalRun);
  const jsonIdentity = entrypoint.indexOf("ALT_ODDS_COVERAGE_JSON_OUTPUT_IDENTITY_INVALID", internalRun);
  const mdRead = entrypoint.indexOf('readFileSync(verifiedMdPath, "utf8")', mdIdentity);
  const jsonRead = entrypoint.indexOf('readFileSync(verifiedJsonPath, "utf8")', jsonIdentity);
  const tempCreate = entrypoint.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = entrypoint.indexOf("fsyncSync(fd)", tempCreate);
  const tempIdentity = entrypoint.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationIdentity = entrypoint.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)", tempIdentity);
  const rename = entrypoint.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);
  const mdPublish = entrypoint.indexOf("ALT_ODDS_COVERAGE_MD_PUBLISH_TEMP_IDENTITY_INVALID", mdRead);
  const mdDestination = entrypoint.indexOf("ALT_ODDS_COVERAGE_MD_PUBLISH_DESTINATION_IDENTITY_INVALID", mdPublish);
  const jsonPublish = entrypoint.indexOf("ALT_ODDS_COVERAGE_JSON_PUBLISH_TEMP_IDENTITY_INVALID", jsonRead);
  const jsonDestination = entrypoint.indexOf("ALT_ODDS_COVERAGE_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID", jsonPublish);

  assert.ok(mdIdentity > internalRun && jsonIdentity > internalRun, "generated report identities must be checked after isolated aggregation");
  assert.ok(mdRead > mdIdentity && jsonRead > jsonIdentity, "generated reports must not be read before identity checks");
  assert.ok(
    tempCreate >= 0 &&
      fsync > tempCreate &&
      tempIdentity > fsync &&
      destinationIdentity > tempIdentity &&
      rename > destinationIdentity,
    "publication must be exclusive, durable, temp-verified, destination-reverified, and atomic",
  );
  assert.ok(mdPublish > mdRead && mdDestination > mdPublish, "markdown publication must reverify its destination");
  assert.ok(jsonPublish > jsonRead && jsonDestination > jsonPublish, "json publication must reverify its destination");
  assert.match(entrypoint, /if \(existsSync\(path\)\) \{\s*assertCanonicalSingleLinkRegularFile\(path, destinationErrorCode\);\s*\}/s);
  assert.match(entrypoint, /ALT_ODDS_COVERAGE_MD_OUTPUT_MISSING/u);
  assert.match(entrypoint, /ALT_ODDS_COVERAGE_JSON_OUTPUT_MISSING/u);
  assert.match(entrypoint, /rmSync\(workspace, \{ recursive: true, force: true \}\)/u);
});

test("alternative odds coverage preflight fixes the historical population to settled trifecta rows", () => {
  assert.match(preflight, /dh\.bet_type IS NULL/);
  assert.match(preflight, /dh\.bet_type != '3連単'/);
  assert.match(preflight, /dh\.returned IS NULL/);
  assert.match(preflight, /dh\.returned != 0/);
  assert.match(preflight, /dh\.bet_type='3連単'/);
  assert.match(preflight, /dh\.returned=0/);
  assert.match(preflight, /GROUP BY dh\.race_id/);
  assert.match(preflight, /HAVING COUNT\(\*\) != 1/);
});

test("alternative odds coverage preflight uses canonical read-only database identity without path disclosure", () => {
  const identity = preflight.indexOf("assertCanonicalSingleLinkRegularFile");
  const open = preflight.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(identity >= 0 && open > identity, "database identity must be verified before opening SQLite");
  assert.match(preflight, /PRAGMA query_only = ON/);
  assert.doesNotMatch(preflight, /DB not found: \$\{DB_PATH\}/);
});

test("alternative odds coverage internal re-verifies canonical read-only database identity without path disclosure", () => {
  const identity = internal.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = internal.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(identity >= 0 && open > identity, "internal aggregation must re-verify DB identity before opening SQLite");
  assert.match(internal, /ALT_ODDS_COVERAGE_RESEARCH_DB_UNAVAILABLE/);
  assert.match(internal, /PRAGMA query_only = ON/);
  assert.doesNotMatch(internal, /DB not found: \$\{DB_PATH\}/);
});

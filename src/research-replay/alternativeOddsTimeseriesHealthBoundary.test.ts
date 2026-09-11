import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypoint = readFileSync("scripts/check-alternative-odds-timeseries-health.ts", "utf8");
const preflight = readFileSync("scripts/audit-alternative-odds-timeseries-health-cohort.ts", "utf8");
const internal = readFileSync("scripts/check-alternative-odds-timeseries-health-internal.ts", "utf8");

test("alternative odds health runs canonical cohort preflight and DB launch revalidation before private coverage/readiness aggregation", () => {
  const guard = entrypoint.indexOf('run("scripts/audit-alternative-odds-timeseries-health-cohort.ts")');
  const handoffIdentity = entrypoint.indexOf("ALTERNATIVE_ODDS_HEALTH_DB_HANDOFF_IDENTITY_INVALID");
  const mdPreexisting = entrypoint.indexOf("ALTERNATIVE_ODDS_HEALTH_MD_PREEXISTING_IDENTITY_INVALID");
  const jsonPreexisting = entrypoint.indexOf("ALTERNATIVE_ODDS_HEALTH_JSON_PREEXISTING_IDENTITY_INVALID");
  const childHandoffIdentity = entrypoint.indexOf("ALTERNATIVE_ODDS_HEALTH_DB_CHILD_HANDOFF_IDENTITY_INVALID");
  const workspace = entrypoint.indexOf("mkdtempSync(", childHandoffIdentity);
  const launchIdentity = entrypoint.indexOf("ALTERNATIVE_ODDS_HEALTH_DB_CHILD_LAUNCH_IDENTITY_INVALID", workspace);
  const internalRun = entrypoint.indexOf("const health = spawnSync", launchIdentity);
  const mdPostflight = entrypoint.indexOf("ALTERNATIVE_ODDS_HEALTH_MD_OUTPUT_IDENTITY_INVALID", internalRun);
  const jsonPostflight = entrypoint.indexOf("ALTERNATIVE_ODDS_HEALTH_JSON_OUTPUT_IDENTITY_INVALID", internalRun);
  assert.ok(guard >= 0, "entrypoint must invoke cohort preflight");
  assert.ok(handoffIdentity > guard, "database identity must be reverified after preflight");
  assert.ok(mdPreexisting > handoffIdentity && jsonPreexisting > handoffIdentity, "existing report paths must be verified before the internal writer runs");
  assert.ok(childHandoffIdentity > mdPreexisting && childHandoffIdentity > jsonPreexisting, "database identity must be reverified after report-path checks and before isolated workspace setup");
  assert.ok(workspace > childHandoffIdentity, "isolated workspace must be created only after child DB handoff verification");
  assert.ok(launchIdentity > workspace, "database identity must be reverified after workspace setup and immediately before child launch");
  assert.ok(internalRun > launchIdentity, "internal health aggregation must run only after launch-time DB revalidation");
  assert.ok(mdPostflight > internalRun && jsonPostflight > internalRun, "published report identities must be verified before success");
  assert.match(entrypoint, /if \(preflight !== 0\)/);
  assert.match(entrypoint, /process\.exit\(preflight\)/);
  assert.match(entrypoint, /ALTERNATIVE_ODDS_HEALTH_DB_MISSING/);
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(\s*DB_PATH,/u);
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(\s*handoffDbPath,\s*"ALTERNATIVE_ODDS_HEALTH_DB_CHILD_HANDOFF_IDENTITY_INVALID"/u);
  assert.match(entrypoint, /BOAT_PON_DB_PATH: launchDbPath/);
  assert.doesNotMatch(entrypoint, /BOAT_PON_DB_PATH: childDbPath/);
  assert.match(entrypoint, /ALTERNATIVE_ODDS_HEALTH_MD_OUTPUT_MISSING/);
  assert.match(entrypoint, /ALTERNATIVE_ODDS_HEALTH_JSON_OUTPUT_MISSING/);
  assert.doesNotMatch(entrypoint, /DB not found: \$\{DB_PATH\}/);
});

test("alternative odds health internal revalidates the DB before read-only query-only analysis", () => {
  const identity = internal.indexOf("ALTERNATIVE_ODDS_HEALTH_INTERNAL_DB_IDENTITY_INVALID");
  const open = internal.indexOf("new DatabaseSync(dbPath, { readOnly: true })");
  const queryOnly = internal.indexOf("PRAGMA query_only=ON");
  assert.ok(identity >= 0 && open > identity, "internal SQLite open must follow canonical identity verification");
  assert.ok(queryOnly > open, "internal SQLite connection must enter query-only mode before analysis queries");
  assert.match(internal, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(internal, /new DatabaseSync\(DB_PATH/);
  assert.doesNotMatch(internal, /DB not found: \$\{DB_PATH\}/);
});

test("alternative odds health isolates internal writes and publishes verified outputs atomically", () => {
  const workspace = entrypoint.indexOf('mkdtempSync(join(tmpdir(), "boat-pon-alternative-odds-health-"))');
  const internalRun = entrypoint.indexOf("const health = spawnSync", workspace);
  const workspaceMdIdentity = entrypoint.indexOf("ALTERNATIVE_ODDS_HEALTH_MD_WORKSPACE_OUTPUT_IDENTITY_INVALID", internalRun);
  const workspaceJsonIdentity = entrypoint.indexOf("ALTERNATIVE_ODDS_HEALTH_JSON_WORKSPACE_OUTPUT_IDENTITY_INVALID", internalRun);
  const mdRead = entrypoint.indexOf('readFileSync(workspaceMd, "utf8")', workspaceMdIdentity);
  const jsonRead = entrypoint.indexOf('readFileSync(workspaceJson, "utf8")', workspaceJsonIdentity);
  const tempCreate = entrypoint.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = entrypoint.indexOf("fsyncSync(fd)", tempCreate);
  const tempIdentity = entrypoint.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, errorCode)", fsync);
  const rename = entrypoint.indexOf("renameSync(verifiedTempPath, path)", tempIdentity);
  assert.ok(workspace >= 0, "internal writer must run in an isolated workspace");
  assert.ok(internalRun > workspace, "internal process must start only after workspace creation");
  assert.ok(workspaceMdIdentity > internalRun && workspaceJsonIdentity > internalRun, "workspace outputs must be identity-verified before reads");
  assert.ok(mdRead > workspaceMdIdentity && jsonRead > workspaceJsonIdentity, "workspace outputs must be read only after identity verification");
  assert.ok(tempCreate >= 0 && fsync > tempCreate, "atomic publication must use exclusive temp creation and fsync");
  assert.ok(tempIdentity > fsync && rename > tempIdentity, "temp identity verification must precede atomic rename");
  assert.match(entrypoint, /cwd: workspace/u);
  assert.match(entrypoint, /stdio: \["ignore", "pipe", "pipe"\]/u);
  assert.match(entrypoint, /ALTERNATIVE_ODDS_HEALTH_INTERNAL_FAILED/u);
  assert.match(entrypoint, /ALTERNATIVE_ODDS_HEALTH_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(entrypoint, /ALTERNATIVE_ODDS_HEALTH_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(entrypoint, /atomicPublish\(\s*OUT_MD,\s*markdown,/u);
  assert.match(entrypoint, /atomicPublish\(\s*OUT_JSON,\s*json,/u);
});

test("alternative odds health forward overlap population is fixed to unique settled trifecta BUY rows", () => {
  assert.match(preflight, /dh\.bet_type IS NULL/);
  assert.match(preflight, /dh\.bet_type != '3連単'/);
  assert.match(preflight, /dh\.returned IS NULL/);
  assert.match(preflight, /dh\.returned != 0/);
  assert.match(preflight, /dh\.bet_type='3連単'/);
  assert.match(preflight, /dh\.returned=0/);
  assert.match(preflight, /GROUP BY dh\.race_id/);
  assert.match(preflight, /HAVING COUNT\(\*\) != 1/);
});

test("alternative odds health preflight verifies canonical read-only DB identity without path disclosure", () => {
  const identity = preflight.indexOf("assertCanonicalSingleLinkRegularFile");
  const open = preflight.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(identity >= 0 && open > identity, "database identity must be verified before opening SQLite");
  assert.match(preflight, /PRAGMA query_only = ON/);
  assert.doesNotMatch(preflight, /DB not found: \$\{DB_PATH\}/);
});

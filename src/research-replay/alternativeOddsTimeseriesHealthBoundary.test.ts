import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypoint = readFileSync("scripts/check-alternative-odds-timeseries-health.ts", "utf8");
const preflight = readFileSync("scripts/audit-alternative-odds-timeseries-health-cohort.ts", "utf8");

test("alternative odds health runs canonical cohort preflight and DB handoff revalidation before private coverage/readiness aggregation", () => {
  const guard = entrypoint.indexOf('run("scripts/audit-alternative-odds-timeseries-health-cohort.ts")');
  const handoffIdentity = entrypoint.indexOf("ALTERNATIVE_ODDS_HEALTH_DB_HANDOFF_IDENTITY_INVALID");
  const mdPreexisting = entrypoint.indexOf("ALTERNATIVE_ODDS_HEALTH_MD_PREEXISTING_IDENTITY_INVALID");
  const jsonPreexisting = entrypoint.indexOf("ALTERNATIVE_ODDS_HEALTH_JSON_PREEXISTING_IDENTITY_INVALID");
  const internal = entrypoint.indexOf('run("scripts/check-alternative-odds-timeseries-health-internal.ts"');
  const mdPostflight = entrypoint.indexOf("ALTERNATIVE_ODDS_HEALTH_MD_OUTPUT_IDENTITY_INVALID");
  const jsonPostflight = entrypoint.indexOf("ALTERNATIVE_ODDS_HEALTH_JSON_OUTPUT_IDENTITY_INVALID");
  assert.ok(guard >= 0, "entrypoint must invoke cohort preflight");
  assert.ok(handoffIdentity > guard, "database identity must be reverified after preflight");
  assert.ok(mdPreexisting > handoffIdentity && jsonPreexisting > handoffIdentity, "existing report paths must be verified before the internal writer runs");
  assert.ok(internal > mdPreexisting && internal > jsonPreexisting, "internal health aggregation must run only after report-path preflight");
  assert.ok(mdPostflight > internal && jsonPostflight > internal, "generated report identities must be verified before success");
  assert.match(entrypoint, /if \(preflight !== 0\)/);
  assert.match(entrypoint, /process\.exit\(preflight\)/);
  assert.match(entrypoint, /ALTERNATIVE_ODDS_HEALTH_DB_MISSING/);
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(\s*DB_PATH,/u);
  assert.match(entrypoint, /BOAT_PON_DB_PATH: handoffDbPath/);
  assert.match(entrypoint, /ALTERNATIVE_ODDS_HEALTH_MD_OUTPUT_MISSING/);
  assert.match(entrypoint, /ALTERNATIVE_ODDS_HEALTH_JSON_OUTPUT_MISSING/);
  assert.doesNotMatch(entrypoint, /DB not found: \$\{DB_PATH\}/);
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

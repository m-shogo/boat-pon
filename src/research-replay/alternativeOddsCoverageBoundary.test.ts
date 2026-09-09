import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypoint = readFileSync("scripts/audit-alternative-odds-coverage.ts", "utf-8");
const preflight = readFileSync("scripts/audit-alternative-odds-coverage-preflight.ts", "utf-8");
const internal = readFileSync("scripts/audit-alternative-odds-coverage-internal.ts", "utf-8");

test("alternative odds coverage runs cohort preflight before internal aggregation", () => {
  const guard = entrypoint.indexOf('run("scripts/audit-alternative-odds-coverage-preflight.ts")');
  const internalRun = entrypoint.indexOf('run("scripts/audit-alternative-odds-coverage-internal.ts")');
  assert.ok(guard >= 0, "entrypoint must invoke forward cohort preflight");
  assert.ok(internalRun > guard, "internal coverage aggregation must run only after preflight");
  assert.match(entrypoint, /if \(preflight !== 0\)/);
  assert.match(entrypoint, /process\.exit\(preflight\)/);
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

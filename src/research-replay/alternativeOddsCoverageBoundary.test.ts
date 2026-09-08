import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypoint = readFileSync("scripts/audit-alternative-odds-coverage.ts", "utf-8");
const preflight = readFileSync("scripts/audit-alternative-odds-coverage-preflight.ts", "utf-8");

test("alternative odds coverage runs cohort preflight before internal aggregation", () => {
  const guard = entrypoint.indexOf('run("scripts/audit-alternative-odds-coverage-preflight.ts")');
  const internal = entrypoint.indexOf('run("scripts/audit-alternative-odds-coverage-internal.ts")');
  assert.ok(guard >= 0, "entrypoint must invoke forward cohort preflight");
  assert.ok(internal > guard, "internal coverage aggregation must run only after preflight");
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

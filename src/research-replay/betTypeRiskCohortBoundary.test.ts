import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrypoint = readFileSync("scripts/analyze-bet-type-risk-factors.ts", "utf8");
const preflight = readFileSync("scripts/audit-bet-type-risk-factors-cohort.ts", "utf8");

test("bet type risk analysis runs canonical cohort preflight before internal analysis", () => {
  const guard = entrypoint.indexOf('run("scripts/audit-bet-type-risk-factors-cohort.ts")');
  const analysis = entrypoint.indexOf('run("scripts/analyze-bet-type-risk-factors-internal.ts")');
  assert.ok(guard >= 0, "entrypoint must invoke cohort preflight");
  assert.ok(analysis > guard, "internal analysis must run only after preflight");
  assert.match(entrypoint, /if \(preflight !== 0\)/);
  assert.match(entrypoint, /process\.exit\(preflight\)/);
});

test("bet type risk cohort is fixed to unique settled trifecta historical BUY rows", () => {
  assert.match(preflight, /dh\.bet_type IS NULL/);
  assert.match(preflight, /dh\.bet_type != '3連単'/);
  assert.match(preflight, /dh\.returned IS NULL/);
  assert.match(preflight, /dh\.returned != 0/);
  assert.match(preflight, /dh\.bet_type='3連単'/);
  assert.match(preflight, /dh\.returned=0/);
  assert.match(preflight, /GROUP BY dh\.race_id/);
  assert.match(preflight, /HAVING COUNT\(\*\) != 1/);
});

test("bet type risk cohort preflight verifies canonical read-only DB identity without configured path disclosure", () => {
  const identity = preflight.indexOf("assertCanonicalSingleLinkRegularFile");
  const open = preflight.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(identity >= 0 && open > identity);
  assert.match(preflight, /PRAGMA query_only = ON/);
  assert.doesNotMatch(preflight, /DB not found: \$\{DB_PATH\}/);
});

import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const runnerSource = readFileSync("scripts/run-odds-payout-gap-safe.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-odds-payout-gap-completeness.ts", "utf-8");

test("odds-payout-gap safe runner executes settlement preflight before analysis", () => {
  const preflight = runnerSource.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const analysis = runnerSource.indexOf('run("scripts/analyze-odds-payout-gap.ts")');

  assert.ok(preflight >= 0, "safe runner must invoke payout completeness preflight");
  assert.ok(analysis > preflight, "analysis must run only after the payout completeness preflight");
});

test("odds-payout-gap safe runner fails closed before analysis when preflight fails", () => {
  assert.match(runnerSource, /if \(preflight !== 0\)/);
  assert.match(runnerSource, /process\.exit\(preflight\)/);

  const guard = runnerSource.indexOf("if (preflight !== 0)");
  const analysis = runnerSource.indexOf('run("scripts/analyze-odds-payout-gap.ts")');
  assert.ok(guard >= 0 && guard < analysis, "preflight failure guard must precede analysis execution");
});

test("odds-payout-gap completeness audit covers the full research population and remains read-only", () => {
  assert.match(auditSource, /dh\.decision = 'BUY'/);
  assert.match(auditSource, /dh\.run_kind = 'historical-backfill'/);
  assert.match(auditSource, /rp\.bet_type = 'trifecta'/);
  assert.match(auditSource, /readOnly: true/);
  assert.match(auditSource, /PRAGMA query_only = ON/);
  assert.match(auditSource, /assertCanonicalSingleLinkRegularFile/);
  assert.match(auditSource, /if \(!result\.complete\)/);
});

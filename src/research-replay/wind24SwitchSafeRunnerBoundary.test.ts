import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const runnerSource = readFileSync("scripts/run-wind24-exh1-switch-deep-dive-safe.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-wind24-exh1-switch-payout-completeness.ts", "utf-8");
const analysisSource = readFileSync("scripts/analyze-wind24-exh1-switch-deep-dive.ts", "utf-8");

test("wind24 switch safe runner checks payout completeness before deep-dive", () => {
  const preflight = runnerSource.indexOf('run("scripts/audit-wind24-exh1-switch-payout-completeness.ts")');
  const analysis = runnerSource.indexOf('run("scripts/analyze-wind24-exh1-switch-deep-dive.ts")');
  assert.ok(preflight >= 0);
  assert.ok(analysis > preflight);
});

test("wind24 switch safe runner fails closed before promotion/demotion analysis", () => {
  assert.match(runnerSource, /if \(preflight !== 0\)/);
  assert.match(runnerSource, /process\.exit\(preflight\)/);
  assert.ok(runnerSource.indexOf("if (preflight !== 0)") < runnerSource.indexOf('run("scripts/analyze-wind24-exh1-switch-deep-dive.ts")'));
});

test("wind24 payout preflight matches the deep-dive population and is read-only", () => {
  assert.match(auditSource, /rw\.wind_speed_mps >= 2 AND rw\.wind_speed_mps < 4/);
  assert.match(auditSource, /re\.boat = 1/);
  assert.match(auditSource, /dh\.selection = '1-2-3'/);
  assert.match(auditSource, /rp\.bet_type = 'trifecta'/);
  assert.match(auditSource, /readOnly: true/);
  assert.match(auditSource, /PRAGMA query_only = ON/);
  assert.match(auditSource, /assertCanonicalSingleLinkRegularFile/);
  assert.match(auditSource, /total > 0 && covered === total/);
  assert.match(analysisSource, /格上げ条件/);
  assert.match(analysisSource, /降格条件/);
});

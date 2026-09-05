import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const runnerSource = readFileSync("scripts/run-payout-rebase-safe.ts", "utf-8");
const analysisSource = readFileSync("scripts/analyze-payout-rebase.ts", "utf-8");

test("payout rebase safe runner executes settlement preflight before analysis", () => {
  const preflight = runnerSource.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const analysis = runnerSource.indexOf('run("scripts/analyze-payout-rebase.ts")');

  assert.ok(preflight >= 0, "safe runner must invoke settlement completeness preflight");
  assert.ok(analysis > preflight, "payout rebase analysis must run only after the settlement preflight");
});

test("payout rebase safe runner fails closed before classifications when preflight fails", () => {
  assert.match(runnerSource, /if \(preflight !== 0\)/);
  assert.match(runnerSource, /process\.exit\(preflight\)/);

  const guard = runnerSource.indexOf("if (preflight !== 0)");
  const analysis = runnerSource.indexOf('run("scripts/analyze-payout-rebase.ts")');
  assert.ok(guard >= 0 && guard < analysis, "preflight failure guard must precede payout rebase analysis");
});

test("legacy payout rebase still depends on official payout values and remains research-only", () => {
  assert.match(analysisSource, /race_payouts\.payout_yen/);
  assert.match(analysisSource, /COALESCE/);
  assert.match(analysisSource, /readOnly: true/);
  assert.match(analysisSource, /本番 decision ロジック変更/);
});

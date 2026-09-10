import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const runnerSource = readFileSync("scripts/run-payout-rebase-safe.ts", "utf-8");
const entrypointSource = readFileSync("scripts/analyze-payout-rebase.ts", "utf-8");
const internalSource = readFileSync("scripts/analyze-payout-rebase-internal.ts", "utf-8");

test("payout rebase safe runner executes settlement preflight before guarded analysis entrypoint", () => {
  const preflight = runnerSource.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const analysis = runnerSource.indexOf('run("scripts/analyze-payout-rebase.ts")');

  assert.ok(preflight >= 0, "safe runner must invoke settlement completeness preflight");
  assert.ok(analysis > preflight, "guarded payout rebase entrypoint must run only after the settlement preflight");
});

test("payout rebase safe runner fails closed before classifications when preflight fails", () => {
  assert.match(runnerSource, /if \(preflight !== 0\)/);
  assert.match(runnerSource, /process\.exit\(preflight\)/);

  const guard = runnerSource.indexOf("if (preflight !== 0)");
  const analysis = runnerSource.indexOf('run("scripts/analyze-payout-rebase.ts")');
  assert.ok(guard >= 0 && guard < analysis, "preflight failure guard must precede guarded payout rebase entrypoint");
});

test("direct payout rebase entrypoint independently retains preflight and verified DB handoff boundaries", () => {
  const preflight = entrypointSource.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const verify = entrypointSource.indexOf('"PAYOUT_REBASE_PRIMARY_DB_IDENTITY_INVALID"');
  const internal = entrypointSource.indexOf('run("scripts/analyze-payout-rebase-internal.ts"');
  assert.ok(preflight >= 0 && verify > preflight, "direct invocation must verify DB identity only after settlement preflight");
  assert.ok(internal > verify, "internal analysis must run only after the verified DB handoff");
});

test("legacy payout rebase implementation still depends on official payout values and remains research-only", () => {
  assert.match(internalSource, /race_payouts\.payout_yen/);
  assert.match(internalSource, /COALESCE/);
  assert.match(internalSource, /readOnly: true/);
  assert.match(internalSource, /本番 decision ロジック変更/);
});

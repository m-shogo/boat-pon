import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const runnerSource = readFileSync("scripts/analyze-odds-payout-gap.ts", "utf-8");
const auditSource = readFileSync("scripts/audit-odds-payout-gap-completeness.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("odds-payout-gap normal entrypoint executes settlement preflight before raw analysis", () => {
  assert.equal(pkg.scripts?.["analyze:odds-payout-gap"], "tsx scripts/analyze-odds-payout-gap.ts");
  const preflight = runnerSource.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const analysis = runnerSource.indexOf('run("scripts/analyze-odds-payout-gap-raw.ts")');

  assert.ok(preflight >= 0, "normal entrypoint must invoke payout completeness preflight");
  assert.ok(analysis > preflight, "raw analysis must run only after the payout completeness preflight");
});

test("odds-payout-gap normal entrypoint fails closed before raw analysis when preflight fails", () => {
  assert.match(runnerSource, /if \(preflight !== 0\)/);
  assert.match(runnerSource, /process\.exit\(preflight\)/);

  const guard = runnerSource.indexOf("if (preflight !== 0)");
  const analysis = runnerSource.indexOf('run("scripts/analyze-odds-payout-gap-raw.ts")');
  assert.ok(guard >= 0 && guard < analysis, "preflight failure guard must precede raw analysis execution");
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

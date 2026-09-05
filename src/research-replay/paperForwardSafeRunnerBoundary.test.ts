import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync("scripts/run-paper-forward-monitor-safe.ts", "utf-8");

test("paper-forward safe runner executes settlement preflight before monitor", () => {
  const preflight = source.indexOf('run("scripts/audit-paper-forward-payout-completeness.ts")');
  const monitor = source.indexOf('run("scripts/report-paper-forward-monitor.ts")');

  assert.ok(preflight >= 0, "safe runner must invoke payout completeness preflight");
  assert.ok(monitor > preflight, "monitor must run only after the payout completeness preflight");
});

test("paper-forward safe runner fails closed before monitor output when preflight fails", () => {
  assert.match(source, /if \(preflight !== 0\)/);
  assert.match(source, /process\.exit\(preflight\)/);

  const guard = source.indexOf("if (preflight !== 0)");
  const monitor = source.indexOf('run("scripts/report-paper-forward-monitor.ts")');
  assert.ok(guard >= 0 && guard < monitor, "preflight failure guard must precede monitor execution");
});

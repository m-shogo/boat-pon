import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync("scripts/run-paper-forward-monitor-safe.ts", "utf-8");
const compatibilityPreflight = readFileSync("scripts/audit-paper-forward-payout-completeness.ts", "utf-8");

test("paper-forward safe runner executes canonical settlement preflight before monitor", () => {
  const preflight = source.indexOf('run("scripts/audit-paper-forward-monitor-payout-completeness.ts")');
  const monitor = source.indexOf('run("scripts/report-paper-forward-monitor.ts")');

  assert.ok(preflight >= 0, "safe runner must invoke canonical payout settlement preflight");
  assert.ok(monitor > preflight, "monitor must run only after the canonical payout settlement preflight");
});

test("paper-forward safe runner fails closed before monitor output when preflight fails", () => {
  assert.match(source, /if \(preflight !== 0\)/);
  assert.match(source, /process\.exit\(preflight\)/);

  const guard = source.indexOf("if (preflight !== 0)");
  const monitor = source.indexOf('run("scripts/report-paper-forward-monitor.ts")');
  assert.ok(guard >= 0 && guard < monitor, "preflight failure guard must precede monitor execution");
});

test("legacy payout completeness path delegates to the canonical settlement-integrity authority", () => {
  assert.match(
    compatibilityPreflight,
    /CANONICAL_PREFLIGHT = "scripts\/audit-paper-forward-monitor-payout-completeness\.ts"/,
  );
  assert.match(compatibilityPreflight, /spawnSync/);
  assert.match(compatibilityPreflight, /if \(status !== 0\)/);
  assert.match(compatibilityPreflight, /process\.exit\(status\)/);
  assert.doesNotMatch(compatibilityPreflight, /new DatabaseSync/);
  assert.doesNotMatch(compatibilityPreflight, /FROM decision_history/);
});

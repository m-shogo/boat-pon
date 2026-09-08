import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/report-exacta-forward-monitor.ts", "utf8");
const preflight = readFileSync("scripts/audit-exacta-forward-monitor-settlements.ts", "utf8");
const internal = readFileSync("scripts/report-exacta-forward-monitor-internal.ts", "utf8");

test("exacta forward monitor cannot bypass cohort and settlement preflight", () => {
  const audit = entrypoint.indexOf('run("scripts/audit-exacta-forward-monitor-settlements.ts")');
  const guard = entrypoint.indexOf("if (preflight !== 0)");
  const monitor = entrypoint.indexOf('run("scripts/report-exacta-forward-monitor-internal.ts")');
  assert.ok(audit >= 0 && guard > audit && monitor > guard);
  assert.match(entrypoint, /process\.exit\(preflight\)/);
});

test("exacta forward preflight fails closed on decision cohort drift and non-zero or unknown settlement return states", () => {
  assert.match(preflight, /assertCanonicalSingleLinkRegularFile\(DB_PATH/);
  assert.match(preflight, /readOnly: true/);
  assert.match(preflight, /PRAGMA query_only = ON/);
  assert.match(preflight, /t\.bet_type IS NULL OR t\.bet_type != '3連単'/);
  assert.match(preflight, /t\.returned IS NULL OR t\.returned != 0/);
  assert.match(preflight, /rp\.bet_type='exacta'/);
  assert.match(preflight, /rp\.returned IS NULL OR rp\.returned != 0/);
  assert.match(preflight, /EXACTA_FORWARD_MONITOR_DECISION_COHORT_INVALID/);
  assert.match(preflight, /EXACTA_FORWARD_MONITOR_SETTLEMENT_RETURN_INVALID/);
});

test("legacy exacta monitor stays research-only behind the guard", () => {
  assert.match(internal, /historical_alternative_odds/);
  assert.match(internal, /readOnly: true/);
  assert.match(internal, /PRAGMA query_only = ON/);
  assert.match(internal, /BUY昇格/);
});

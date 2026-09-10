import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/report-exacta-forward-monitor.ts", "utf8");
const preflight = readFileSync("scripts/audit-exacta-forward-monitor-settlements.ts", "utf8");
const internal = readFileSync("scripts/report-exacta-forward-monitor-internal.ts", "utf8");

test("exacta forward monitor cannot bypass cohort and settlement preflight", () => {
  const audit = entrypoint.indexOf('run("scripts/audit-exacta-forward-monitor-settlements.ts")');
  const guard = entrypoint.indexOf("if (preflight !== 0)");
  const handoffIdentity = entrypoint.indexOf("EXACTA_FORWARD_MONITOR_DB_HANDOFF_IDENTITY_INVALID");
  const candidateIdentity = entrypoint.indexOf("EXACTA_FORWARD_MONITOR_CANDIDATE_IDENTITY_INVALID");
  const monitor = entrypoint.indexOf('run("scripts/report-exacta-forward-monitor-internal.ts"');
  assert.ok(
    audit >= 0 &&
      guard > audit &&
      handoffIdentity > guard &&
      candidateIdentity > handoffIdentity &&
      monitor > candidateIdentity,
  );
  assert.match(entrypoint, /process\.exit\(preflight\)/);
  assert.match(entrypoint, /EXACTA_FORWARD_MONITOR_DB_MISSING/u);
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(\s*DB_PATH,/u);
  assert.match(entrypoint, /EXACTA_FORWARD_MONITOR_CANDIDATES_MISSING/u);
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(\s*CANDIDATES_PATH,/u);
  assert.match(entrypoint, /BOAT_PON_DB_PATH: handoffDbPath/u);
});

test("exacta forward preflight fails closed on decision cohort drift and invalid settlement lines", () => {
  assert.match(preflight, /assertCanonicalSingleLinkRegularFile\(DB_PATH/);
  assert.match(preflight, /readOnly: true/);
  assert.match(preflight, /PRAGMA query_only = ON/);
  assert.match(preflight, /t\.bet_type IS NULL OR t\.bet_type != '3連単'/);
  assert.match(preflight, /t\.returned IS NULL OR t\.returned != 0/);
  assert.match(preflight, /rp\.bet_type='exacta'/);
  assert.match(preflight, /rp\.returned IS NULL OR rp\.returned != 0/);
  assert.match(preflight, /rp\.combination != ''/);
  assert.match(preflight, /rp\.payout_yen > 0/);
  assert.match(preflight, /line_count != 1 OR valid_count != 1/);
  assert.match(preflight, /EXACTA_FORWARD_MONITOR_DECISION_COHORT_INVALID/);
  assert.match(preflight, /EXACTA_FORWARD_MONITOR_SETTLEMENT_RETURN_INVALID/);
  assert.match(preflight, /EXACTA_FORWARD_MONITOR_SETTLEMENT_LINE_INTEGRITY_INVALID/);
});

test("legacy exacta monitor stays research-only behind the guard", () => {
  assert.match(internal, /historical_alternative_odds/);
  assert.match(internal, /readOnly: true/);
  assert.match(internal, /PRAGMA query_only = ON/);
  assert.match(internal, /BUY昇格/);
});

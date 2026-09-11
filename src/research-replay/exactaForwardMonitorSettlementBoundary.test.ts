import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/report-exacta-forward-monitor.ts", "utf8");
const preflight = readFileSync("scripts/audit-exacta-forward-monitor-settlements.ts", "utf8");
const raw = readFileSync("scripts/report-exacta-forward-monitor-raw.ts", "utf8");
const internal = readFileSync("scripts/report-exacta-forward-monitor-internal.ts", "utf8");

test("exacta forward monitor cannot bypass cohort and settlement preflight", () => {
  const audit = entrypoint.indexOf('run("scripts/audit-exacta-forward-monitor-settlements.ts")');
  const guard = entrypoint.indexOf("if (preflight !== 0)");
  const handoffIdentity = entrypoint.indexOf("EXACTA_FORWARD_MONITOR_DB_HANDOFF_IDENTITY_INVALID");
  const candidateIdentity = entrypoint.indexOf("EXACTA_FORWARD_MONITOR_CANDIDATE_IDENTITY_INVALID");
  const childHandoffIdentity = entrypoint.indexOf("EXACTA_FORWARD_MONITOR_DB_CHILD_HANDOFF_IDENTITY_INVALID");
  const envHandoff = entrypoint.indexOf("process.env.BOAT_PON_DB_PATH = childDbPath");
  const monitor = entrypoint.indexOf('await import("./report-exacta-forward-monitor-internal")');
  assert.ok(
    audit >= 0 &&
      guard > audit &&
      handoffIdentity > guard &&
      candidateIdentity > handoffIdentity &&
      childHandoffIdentity > candidateIdentity &&
      envHandoff > childHandoffIdentity &&
      monitor > envHandoff,
  );
  assert.match(entrypoint, /process\.exit\(preflight\)/);
  assert.match(entrypoint, /EXACTA_FORWARD_MONITOR_DB_MISSING/u);
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(\s*DB_PATH,/u);
  assert.match(entrypoint, /EXACTA_FORWARD_MONITOR_CANDIDATES_MISSING/u);
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(\s*CANDIDATES_PATH,/u);
  assert.match(entrypoint, /EXACTA_FORWARD_MONITOR_DB_CHILD_HANDOFF_IDENTITY_INVALID/u);
  assert.match(entrypoint, /process\.env\.BOAT_PON_DB_PATH = childDbPath/u);
  assert.doesNotMatch(entrypoint, /report-exacta-forward-monitor-raw/u);
  assert.doesNotMatch(entrypoint, /run\("scripts\/report-exacta-forward-monitor-internal\.ts"/u);
});

test("exacta forward raw compatibility module forbids direct CLI execution and cannot bypass canonical preflight", () => {
  assert.match(raw, /EXACTA_FORWARD_MONITOR_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/report-exacta-forward-monitor"\)/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /report-exacta-forward-monitor-internal/);
  assert.doesNotMatch(raw, /DatabaseSync/);
});

test("exacta forward preflight verifies frozen candidate lock identity before reading it", () => {
  const dbIdentity = preflight.indexOf("EXACTA_FORWARD_MONITOR_DB_IDENTITY_INVALID");
  const lockIdentity = preflight.indexOf("EXACTA_FORWARD_MONITOR_LOCK_IDENTITY_INVALID");
  const lockRead = preflight.indexOf('readFileSync(verifiedLockPath, "utf8")');
  const open = preflight.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");

  assert.ok(dbIdentity >= 0 && lockIdentity > dbIdentity && lockRead > lockIdentity && open > lockRead);
  assert.match(preflight, /assertCanonicalSingleLinkRegularFile\(LOCK_PATH/);
  assert.doesNotMatch(preflight, /readFileSync\(LOCK_PATH/);
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

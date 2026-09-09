import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const preflight = readFileSync("scripts/audit-condb-switch-historical-payout-completeness.ts", "utf8");
const runner = readFileSync("scripts/run-condb-switch-historical-closing-odds-safe.ts", "utf8");
const entrypoint = readFileSync("scripts/analyze-condb-switch-historical-closing-odds.ts", "utf8");

test("condB historical payout preflight uses verified read-only positive official trifecta settlements", () => {
  assert.match(preflight, /assertCanonicalSingleLinkRegularFile\(\s*DB_PATH/);
  assert.match(preflight, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(preflight, /PRAGMA query_only = ON/);
  assert.match(preflight, /FROM race_payouts rp/);
  assert.match(preflight, /rp\.bet_type = 'trifecta'/);
  assert.match(preflight, /rp\.returned = 0/);
  assert.match(preflight, /rp\.payout_yen IS NOT NULL/);
  assert.match(preflight, /rp\.payout_yen > 0/);
  assert.match(preflight, /dh\.decision = 'BUY'/);
  assert.match(preflight, /dh\.run_kind = 'historical-backfill'/);
  assert.match(preflight, /dh\.selection = '1-2-3'/);
  assert.match(preflight, /dh\.date >= \?/);
});

test("condB historical payout preflight rejects unknown or returned official payout rows before coverage", () => {
  assert.match(preflight, /rp\.returned IS NULL OR rp\.returned != 0/);
  assert.match(preflight, /CONDB_SWITCH_HISTORICAL_PAYOUT_RETURN_STATE_INVALID/);
  const returnStateGate = preflight.indexOf("const payoutReturnState = db.prepare");
  const coverage = preflight.indexOf("const row = db.prepare");
  assert.ok(returnStateGate >= 0);
  assert.ok(coverage > returnStateGate);
});

test("condB historical payout preflight fails closed on empty or incomplete coverage", () => {
  assert.match(preflight, /total <= 0/);
  assert.match(preflight, /covered > total/);
  assert.match(preflight, /if \(missing !== 0\)/);
  assert.match(preflight, /process\.exit\(2\)/);
});

test("canonical entrypoint verifies the primary DB before payout preflight and guarded analyzer import", () => {
  assert.match(entrypoint, /CONDB_SWITCH_HISTORICAL_PRIMARY_DB_MISSING/);
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(\s*DB_PATH/);
  assert.match(entrypoint, /CONDB_SWITCH_HISTORICAL_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(entrypoint, /BOAT_PON_DB_PATH: verifiedDbPath/);
  assert.doesNotMatch(entrypoint, /DB not found: \$\{DB_PATH\}/);

  const identity = entrypoint.indexOf("assertCanonicalSingleLinkRegularFile");
  const audit = entrypoint.indexOf("audit-condb-switch-historical-payout-completeness.ts");
  const analyzer = entrypoint.indexOf("await import(\"./analyze-condb-switch-historical-closing-odds-raw\")");
  assert.ok(identity >= 0);
  assert.ok(audit > identity);
  assert.ok(analyzer > audit);
});

test("compatibility safe runner delegates to the canonical fail-closed entrypoint", () => {
  assert.match(runner, /analyze-condb-switch-historical-closing-odds\.ts/);
  assert.doesNotMatch(runner, /analyze-condb-switch-historical-closing-odds-raw\.ts/);
  assert.doesNotMatch(runner, /audit-condb-switch-historical-payout-completeness\.ts/);
});
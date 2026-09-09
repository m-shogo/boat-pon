import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/audit-bet-type-coverage.ts", "utf8");

test("bet-type coverage audit verifies canonical read-only DB identity", () => {
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(identity >= 0);
  assert.ok(open > identity);
  assert.match(source, /PRAGMA query_only = ON/);
});

test("bet-type coverage audit fails closed on unknown completed BUY return states and analyzes only returned=0 BUYs", () => {
  assert.match(source, /returned IS NULL/);
  assert.match(source, /unknown historical BUY return states exist in completed coverage population/);
  assert.ok((source.match(/\b(?:dh\.)?returned=0/g) ?? []).length >= 2, "denominator and joinable population must require returned=0");

  const unknownGuard = source.indexOf("const unknownHistoricalBuyReturns");
  const rawRows = source.indexOf("const rawRows = db.prepare");
  const totalBuyRaces = source.indexOf("const totalBuyRaces =");
  assert.ok(unknownGuard >= 0 && rawRows > unknownGuard && totalBuyRaces > unknownGuard);
});

test("bet-type coverage audit fails closed on unknown official payout return states before coverage aggregation", () => {
  assert.match(source, /const unknownOfficialPayoutReturns/);
  assert.match(source, /FROM race_payouts\s+WHERE returned IS NULL OR returned NOT IN \(0, 1\)/);
  assert.match(source, /unknown official payout return states exist in coverage population/);

  const payoutReturnGuard = source.indexOf("const unknownOfficialPayoutReturns");
  const rawRows = source.indexOf("const rawRows = db.prepare");
  const totalPayoutRaces = source.indexOf("const totalPayoutRaces =");
  assert.ok(payoutReturnGuard >= 0 && rawRows > payoutReturnGuard && totalPayoutRaces > payoutReturnGuard);
});

test("bet-type coverage joinability requires usable non-refund official settlement data", () => {
  assert.match(source, /rp\.returned=0/);
  assert.match(source, /rp\.payout_yen IS NOT NULL AND rp\.payout_yen>0/);
  assert.match(source, /rp\.combination IS NOT NULL AND rp\.combination!=''/);
  assert.match(source, /positive\/non-refund/);
});

test("bet-type coverage reports never expose configured DB paths", () => {
  assert.match(source, /const REPORT_DB_LABEL = "canonical research database"/);
  assert.match(source, /dbPath: REPORT_DB_LABEL/);
  assert.doesNotMatch(source, /dbPath: DB_PATH/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
  assert.match(source, /research database unavailable/);
});

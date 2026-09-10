import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrySource = readFileSync("scripts/analyze-ticket-selector-strategies.ts", "utf8");
const auditSource = readFileSync("scripts/audit-ticket-selector-payout-completeness.ts", "utf8");
const coreSource = readFileSync("scripts/analyze-ticket-selector-strategies-core.ts", "utf8");

test("direct ticket-selector analysis cannot bypass compared-market payout completeness", () => {
  const preflight = entrySource.indexOf('run("scripts/audit-ticket-selector-payout-completeness.ts")');
  const identity = entrySource.indexOf("assertCanonicalSingleLinkRegularFile(");
  const analysis = entrySource.indexOf('run("scripts/analyze-ticket-selector-strategies-core.ts"');
  assert.ok(preflight >= 0);
  assert.ok(identity > preflight);
  assert.ok(analysis > identity);
  assert.match(entrySource, /if \(preflight !== 0\)/);
  assert.match(entrySource, /process\.exit\(preflight\)/);
  assert.match(entrySource, /TICKET_SELECTOR_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(entrySource, /BOAT_PON_DB_PATH: verifiedDbPath/);
});

test("ticket-selector preflight covers the exact base population and every compared market", () => {
  assert.match(auditSource, /SELECT DISTINCT dh\.race_id/);
  assert.match(auditSource, /dh\.decision='BUY'/);
  assert.match(auditSource, /dh\.run_kind='historical-backfill'/);
  assert.match(auditSource, /dh\.selection='1-2-3'/);
  assert.match(auditSource, /dh\.current_odds IS NOT NULL/);
  assert.match(auditSource, /dh\.returned=0/);
  assert.match(auditSource, /dh\.returned IS NULL OR dh\.returned != 0/);
  assert.match(auditSource, /target historical BUY cohort contains unknown or returned rows/);
  assert.match(auditSource, /EXCLUDED_VENUES/);
  assert.match(auditSource, /EXCLUDED_RACE_NOS/);
  for (const betType of ["trifecta", "trio", "exacta", "quinella", "wide"]) {
    assert.match(auditSource, new RegExp(`ts\\.bet_type='${betType}'`));
  }
  assert.match(auditSource, /total > 0/);
  assert.match(auditSource, /covered !== total/);
});

test("ticket-selector preflight validates all compared settlement lines without banning legitimate multi-line winners", () => {
  assert.match(auditSource, /ts\.returned=0/);
  assert.match(auditSource, /ts\.returned IS NULL OR ts\.returned != 0/);
  assert.match(auditSource, /invalidSettlementReturnStates/);
  assert.match(auditSource, /ts\.payout_yen>0/);
  assert.match(auditSource, /ts\.payout_yen<=0/);
  assert.match(auditSource, /ts\.combination IS NULL/);
  assert.match(auditSource, /GROUP BY race_id, bet_type, combination/);
  assert.match(auditSource, /HAVING COUNT\(\*\) > 1/);
  assert.match(auditSource, /duplicateCombinationKeys/);
  assert.match(auditSource, /invalidNonRefundRows/);
  assert.match(auditSource, /process\.exit\(2\)/);
  assert.doesNotMatch(auditSource, /HAVING COUNT\(\*\) = 1/);
  assert.doesNotMatch(auditSource, /COUNT\(DISTINCT ts\.combination\) = 1/);
});

test("ticket-selector payout audit verifies database identity and remains query-only", () => {
  const verify = auditSource.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = auditSource.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0);
  assert.ok(open > verify);
  assert.match(auditSource, /PRAGMA query_only = ON/);
});

test("preserved selector core still ranks train and forward strategies from scalar payout ROI", () => {
  assert.match(coreSource, /bestTrain/);
  assert.match(coreSource, /bestFwd/);
  assert.match(coreSource, /coverage:/);
  assert.match(coreSource, /COALESCE\(\(SELECT rp\.payout_yen/);
  assert.match(coreSource, /LIMIT 1/);
});

import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const entrySource = readFileSync("scripts/analyze-ticket-selector-strategies.ts", "utf8");
const auditSource = readFileSync("scripts/audit-ticket-selector-payout-completeness.ts", "utf8");
const coreSource = readFileSync("scripts/analyze-ticket-selector-strategies-core.ts", "utf8");

test("direct ticket-selector analysis cannot bypass compared-market payout completeness", () => {
  const preflight = entrySource.indexOf('run("scripts/audit-ticket-selector-payout-completeness.ts")');
  const analysis = entrySource.indexOf('run("scripts/analyze-ticket-selector-strategies-core.ts")');
  assert.ok(preflight >= 0);
  assert.ok(analysis > preflight);
  assert.match(entrySource, /if \(preflight !== 0\)/);
  assert.match(entrySource, /process\.exit\(preflight\)/);
});

test("ticket-selector preflight covers the exact base population and every compared market", () => {
  assert.match(auditSource, /dh\.decision='BUY'/);
  assert.match(auditSource, /dh\.run_kind='historical-backfill'/);
  assert.match(auditSource, /dh\.selection='1-2-3'/);
  assert.match(auditSource, /dh\.current_odds IS NOT NULL/);
  for (const betType of ["trifecta", "trio", "exacta", "quinella", "wide"]) {
    assert.match(auditSource, new RegExp(`rp\\.bet_type='${betType}'`));
  }
  assert.match(auditSource, /total > 0/);
  assert.match(auditSource, /covered !== total/);
});

test("ticket-selector payout audit verifies database identity and remains query-only", () => {
  const verify = auditSource.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = auditSource.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0);
  assert.ok(open > verify);
  assert.match(auditSource, /PRAGMA query_only = ON/);
});

test("preserved selector core still ranks train and forward strategies from payout ROI", () => {
  assert.match(coreSource, /bestTrain/);
  assert.match(coreSource, /bestFwd/);
  assert.match(coreSource, /coverage:/);
  assert.match(coreSource, /COALESCE\(\(SELECT rp\.payout_yen/);
});

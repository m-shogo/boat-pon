import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("event-context screen uses canonical historical exacta source and completeness authority", () => {
  const source = readFileSync("scripts/analyze-event-market-context.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.doesNotMatch(source, /HAVING COUNT\(\*\)=30/);
});

test("event-context screen fails closed on database identity and settlement completeness", () => {
  const source = readFileSync("scripts/analyze-event-market-context.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertSettlementCompleteness\(\);/);
  assert.match(source, /COUNT\(\*\) AS payout_rows/);
  assert.match(source, /rp\.returned = 0 AND rp\.payout_yen IS NOT NULL AND rp\.payout_yen > 0/);
  assert.match(source, /winner_h\.race_id = rp\.race_id/);
  assert.match(source, /historicalExactaCanonicalSourcePredicate\("winner_h"\)/);
  assert.match(source, /winner_h\.combination = rp\.combination/);
  assert.match(source, /s\.payout_rows = 1 AND s\.valid_rows = 1/);
  assert.match(source, /ambiguous !== 0/);
  assert.match(source, /p\.bet_type='exacta' AND p\.returned=0 AND p\.payout_yen>0/);
  assert.match(source, /EVENT_MARKET_CONTEXT_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /requiredPayout\(row\)/);
  assert.match(source, /EVENT_MARKET_CONTEXT_HIT_PAYOUT_MISSING/);
  assert.doesNotMatch(source, /row\.payout_yen \?\? 0/);
});

test("event-context screen pins settlement validation and analyzed population to one read snapshot", () => {
  const source = readFileSync("scripts/analyze-event-market-context.ts", "utf8");
  const queryOnly = source.indexOf("PRAGMA query_only=ON");
  const begin = source.indexOf('db.exec("BEGIN;")');
  const settlement = source.indexOf("assertSettlementCompleteness();");
  const population = source.indexOf("const rows = db.prepare");

  assert.ok(queryOnly >= 0);
  assert.ok(begin > queryOnly);
  assert.ok(settlement > begin);
  assert.ok(population > settlement);
});

test("event-context payout audit enforces the same exact settlement authority", () => {
  const source = readFileSync("scripts/audit-event-market-context-payout-completeness.ts", "utf8");

  assert.match(source, /COUNT\(\*\) AS payout_rows/);
  assert.match(source, /rp\.returned = 0 AND rp\.payout_yen IS NOT NULL AND rp\.payout_yen > 0/);
  assert.match(source, /historicalExactaCanonicalSourcePredicate\("winner_h"\)/);
  assert.match(source, /winner_h\.combination = rp\.combination/);
  assert.match(source, /s\.payout_rows = 1 AND s\.valid_rows = 1/);
  assert.match(source, /ambiguous !== 0/);
});

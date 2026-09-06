import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("event selection matrix uses canonical historical exacta source and completeness authority", () => {
  const source = readFileSync("scripts/analyze-event-selection-matrix.ts", "utf8");

  assert.match(source, /historicalExactaCanonicalSourcePredicate\("h"\)/);
  assert.match(source, /historicalExactaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.match(source, /HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING/);
  assert.doesNotMatch(source, /COUNT\(\*\) FROM historical_alternative_odds all_odds WHERE all_odds\.race_id=h\.race_id AND all_odds\.bet_type='exacta'\)\s*=\s*30/);
});

test("event selection matrix fails closed on database identity and settlement completeness", () => {
  const source = readFileSync("scripts/analyze-event-selection-matrix.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /assertSettlementCompleteness\(\);/);
  assert.match(source, /EVENT_SELECTION_MATRIX_PAYOUT_COVERAGE_INCOMPLETE/);
  assert.match(source, /payout_yen IS NOT NULL AND payout_yen > 0/);
  assert.match(source, /requiredPayout\(row\)/);
  assert.match(source, /EVENT_SELECTION_MATRIX_HIT_PAYOUT_MISSING/);
  assert.doesNotMatch(source, /row=>row\.payout_yen\?\?0/);
});

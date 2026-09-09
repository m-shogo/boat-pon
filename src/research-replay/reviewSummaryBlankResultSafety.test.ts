import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(process.cwd(), "scripts/report-review-summary-raw.ts"), "utf8");

test("review summary fail-closes blank settled results before aggregation", () => {
  assert.match(source, /makeWhere\("returned = 0 AND result IS NOT NULL", \[\]\)/);
  assert.match(source, /WHERE TRIM\(s\.result\) = ''\n     OR s\.payout_bet_type IS NULL/);
  assert.doesNotMatch(source, /makeWhere\("returned = 0 AND result IS NOT NULL AND result != ''", \[\]\)/);
  assert.match(source, /REVIEW_SUMMARY_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
});

test("review summary denominators and miss lists exclude whitespace results", () => {
  assert.match(source, /result IS NOT NULL AND TRIM\(result\) != '' AND returned = 0/);
  assert.match(source, /decision = 'BUY' AND returned = 0 AND result IS NOT NULL AND TRIM\(result\) != '' AND selection != result/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
});

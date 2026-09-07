import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync("scripts/analyze-wind-direction-by-venue.ts", "utf8");

test("wind-direction exacta settlement coverage permits legitimate multi-line winners", () => {
  assert.match(source, /CASE WHEN COUNT\(\*\)>=1/);
  assert.match(source, /COUNT\(\*\)=COUNT\(DISTINCT rp\.combination\)/);
  assert.match(source, /SUM\(CASE WHEN rp\.returned=0/);
  assert.match(source, /THEN 1 ELSE 0 END\)=COUNT\(\*\)/);
  assert.doesNotMatch(source, /CASE WHEN COUNT\(\*\)=1/);
});

test("wind-direction exacta settlement coverage rejects duplicate exact combinations", () => {
  assert.match(source, /COUNT\(\*\)=COUNT\(DISTINCT rp\.combination\)/);
  assert.match(source, /GROUP BY rp\.race_id/);
  assert.match(source, /rp\.combination='1-4'/);
  assert.match(source, /LIMIT 1/);
});

test("wind-direction exacta settlement coverage rejects malformed, refund, or non-market lines", () => {
  assert.match(source, /rp\.returned=0/);
  assert.match(source, /rp\.combination IS NOT NULL AND rp\.combination!=''/);
  assert.match(source, /rp\.payout_yen IS NOT NULL AND rp\.payout_yen>0/);
  assert.match(source, /winner_h\.combination=rp\.combination/);
  assert.match(source, /WIND_DIRECTION_EXACTA_PAYOUT_COVERAGE_INCOMPLETE/);
});

test("wind-direction research stays canonical, read-only, and path-redacted", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /const REPORT_DB_LABEL = "canonical research database"/);
  assert.match(source, /DB: \$\{REPORT_DB_LABEL\}/);
  assert.doesNotMatch(source, /DB: \$\{DB_PATH\}/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

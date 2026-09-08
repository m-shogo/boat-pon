import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/report-review-summary.ts", "utf8");
const raw = readFileSync("scripts/report-review-summary-raw.ts", "utf8");

test("review summary normal entrypoint pins the canonical research DB before raw reporting", () => {
  assert.match(entry, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(entry, /BOAT_PON_DB_PATH: verifiedDbPath/);
  const verifyAt = entry.indexOf("assertCanonicalSingleLinkRegularFile");
  const rawAt = entry.indexOf("report-review-summary-raw.ts");
  assert.ok(verifyAt >= 0 && rawAt > verifyAt);
});

test("raw review summary independently verifies the canonical DB and remains query-only", () => {
  assert.match(raw, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "REVIEW_SUMMARY_RAW_PRIMARY_DB_IDENTITY_INVALID"\)/);
  assert.match(raw, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(raw, /PRAGMA query_only = ON/);
  assert.doesNotMatch(raw, /new DatabaseSync\(DB_PATH/);
  assert.doesNotMatch(raw, /DB not found: \$\{DB_PATH\}/);
  assert.match(raw, /missing_payout_hits > 0 THEN NULL ELSE ROUND/);
});

test("review summary counts and lists only settled BUY misses", () => {
  const settledMiss = /decision = 'BUY' AND returned = 0 AND result IS NOT NULL AND selection != result/g;
  assert.equal(raw.match(settledMiss)?.length, 2);
  assert.doesNotMatch(raw, /result IS NULL OR selection != result/);
});

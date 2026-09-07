import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("review summary derives decision ROI from official payouts and fails closed on missing hit payouts", () => {
  const source = readFileSync("scripts/report-review-summary-raw.ts", "utf8");

  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /rp\.bet_type = decision_history\.bet_type/);
  assert.match(source, /rp\.combination = decision_history\.selection/);
  assert.match(source, /missing_payout_hits AS missingPayoutHits/);
  assert.match(source, /CASE WHEN missing_payout_hits > 0 THEN NULL ELSE ROUND\(total_payout_odds/);
  assert.doesNotMatch(source, /THEN current_odds ELSE 0 END AS payout_odds/);
});

test("review summary normal entrypoint cannot run raw ROI report before settlement integrity passes", () => {
  const source = readFileSync("scripts/report-review-summary.ts", "utf8");
  const auditIndex = source.indexOf("audit-review-summary-payout-integrity.ts");
  const statusGateIndex = source.indexOf("audit.status !== 0");
  const rawIndex = source.indexOf("report-review-summary-raw.ts");

  assert.ok(auditIndex >= 0);
  assert.ok(statusGateIndex > auditIndex);
  assert.ok(rawIndex > statusGateIndex);
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
});

test("review summary payout audit rejects ambiguous or malformed winning keys while preserving multi-line races", () => {
  const source = readFileSync("scripts/audit-review-summary-payout-integrity.ts", "utf8");

  assert.match(source, /SELECT DISTINCT race_id, bet_type, selection/);
  assert.match(source, /selection = result/);
  assert.match(source, /returned = 0/);
  assert.match(source, /rp\.combination = h\.selection/);
  assert.match(source, /\) != 1/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /REVIEW_SUMMARY_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /GROUP BY rp\.race_id[\s\S]*COUNT\(\*\) = 1/);
});

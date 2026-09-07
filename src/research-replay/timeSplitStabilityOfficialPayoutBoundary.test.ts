import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-time-split-stability.ts", "utf8");

test("time split stability uses exact positive non-refund official settlements", () => {
  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /rp\.bet_type = decision_history\.bet_type/);
  assert.match(source, /rp\.combination = decision_history\.selection/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
});

test("time split stability fails closed on ambiguous winning settlement keys before window ROI", () => {
  assert.match(source, /function assertOfficialSettlementIntegrity\(from: string \| null, to: string \| null\)/);
  assert.match(source, /SELECT DISTINCT race_id, bet_type, selection/);
  assert.match(source, /selection = result/);
  assert.match(source, /returned = 0/);
  assert.match(source, /SELECT COUNT\(\*\)[\s\S]*rp\.combination = h\.selection/);
  assert.match(source, /\) != 1/);
  assert.match(source, /TIME_SPLIT_STABILITY_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);

  const integrity = source.indexOf("assertOfficialSettlementIntegrity(args.from, args.to);");
  const before = source.indexOf('const before = queryPeriod("before"');
  assert.ok(integrity >= 0 && before > integrity);
});

test("time split stability keeps canonical query-only database access without path disclosure", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(/);
  assert.match(source, /new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

test("time split stability preserves missing-payout nulling as a secondary fail-closed guard", () => {
  assert.match(source, /missing_payout_hits AS missingPayoutHits/);
  assert.match(source, /CASE WHEN missing_payout_hits > 0 THEN NULL ELSE ROUND\(total_payout_odds/);
  assert.match(source, /CASE WHEN missing_payout_hits > 0 THEN NULL ELSE ROUND\(\(total_payout_odds - max_payout_odds\)/);
  assert.match(source, /beforeMissingPayoutHits > 0 \|\| row\.afterMissingPayoutHits > 0/);
  assert.match(source, /beforeRoi == null \|\| row\.beforeRoiExMax == null \|\| row\.afterRoi == null \|\| row\.afterRoiExMax == null/);
});

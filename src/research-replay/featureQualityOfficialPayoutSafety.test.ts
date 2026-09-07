import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-feature-quality.ts", "utf8");

test("feature quality report verifies and opens the canonical DB read-only", () => {
  const identityIndex = source.indexOf("assertCanonicalSingleLinkRegularFile(");
  const openIndex = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(identityIndex >= 0);
  assert.ok(openIndex > identityIndex);
  assert.match(source, /PRAGMA query_only\s*=\s*ON/u);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/u);
});

test("feature quality report fails closed on ambiguous winning settlements", () => {
  assert.match(source, /function assertOfficialSettlementIntegrity/u);
  assert.match(source, /SELECT DISTINCT dh\.race_id, dh\.bet_type, dh\.selection/u);
  assert.match(source, /dh\.decision = 'BUY'/u);
  assert.match(source, /dh\.returned = 0/u);
  assert.match(source, /dh\.selection = dh\.result/u);
  assert.match(source, /\) != 1[\s\S]*OR \([\s\S]*\) != 1/u);
  assert.match(source, /rp\.returned = 0/u);
  assert.match(source, /rp\.payout_yen > 0/u);
  assert.match(source, /FEATURE_QUALITY_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/u);
});

test("feature quality ROI uses official payout_yen rather than current_odds", () => {
  assert.match(source, /AS official_payout_yen/u);
  assert.match(source, /rp\.bet_type = dh\.bet_type/u);
  assert.match(source, /rp\.combination = dh\.selection/u);
  assert.match(source, /Number\(r\.official_payout_yen \?\? 0\) \/ 100/u);
  assert.match(source, /roiSource: "official race_payouts\.payout_yen"/u);
  assert.doesNotMatch(source, /payoutOdds\s*=\s*hits\.reduce\([\s\S]*current_odds/u);
});

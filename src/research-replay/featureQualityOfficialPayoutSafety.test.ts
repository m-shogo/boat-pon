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

test("feature quality report maps payout bet types and fails closed on unsupported or ambiguous winning settlements", () => {
  assert.match(source, /function assertOfficialSettlementIntegrity/u);
  assert.match(source, /WHEN '3連単' THEN 'trifecta'/u);
  assert.match(source, /WHEN '3連複' THEN 'trio'/u);
  assert.match(source, /WHEN '2連単' THEN 'exacta'/u);
  assert.match(source, /WHEN '2連複' THEN 'quinella'/u);
  assert.match(source, /WHEN '拡連複' THEN 'wide'/u);
  assert.match(source, /SELECT DISTINCT[\s\S]*payout_bet_type,[\s\S]*dh\.selection/u);
  assert.match(source, /dh\.decision = 'BUY'/u);
  assert.match(source, /dh\.returned = 0/u);
  assert.match(source, /dh\.selection = dh\.result/u);
  assert.match(source, /h\.payout_bet_type IS NULL/u);
  assert.match(source, /rp\.bet_type = h\.payout_bet_type/u);
  assert.match(source, /\) != 1[\s\S]*OR \([\s\S]*\) != 1/u);
  assert.match(source, /rp\.returned = 0/u);
  assert.match(source, /rp\.payout_yen > 0/u);
  assert.match(source, /FEATURE_QUALITY_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/u);
  assert.doesNotMatch(source, /rp\.bet_type = h\.bet_type/u);
});

test("feature quality ROI uses mapped official payout_yen rather than current_odds", () => {
  assert.match(source, /AS official_payout_yen/u);
  assert.match(source, /rp\.bet_type = \$\{payoutBetTypeSql\("dh\.bet_type"\)\}/u);
  assert.match(source, /rp\.combination = dh\.selection/u);
  assert.match(source, /Number\(r\.official_payout_yen \?\? 0\) \/ 100/u);
  assert.match(source, /roiSource: "official race_payouts\.payout_yen"/u);
  assert.doesNotMatch(source, /rp\.bet_type = dh\.bet_type/u);
  assert.doesNotMatch(source, /payoutOdds\s*=\s*hits\.reduce\([\s\S]*current_odds/u);
});

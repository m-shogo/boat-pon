import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-odds-band-outcomes.ts", "utf-8");

test("odds-band outcomes verifies the research DB before read-only SQLite open", () => {
  const verify = source.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0);
  assert.ok(open > verify);
  assert.match(source, /PRAGMA query_only = ON/);
});

test("odds-band ROI uses official payouts and fails closed on missing winning payouts", () => {
  assert.match(source, /FROM race_payouts rp/);
  assert.match(source, /rp\.payout_yen \/ 100\.0/);
  assert.match(source, /rp\.bet_type = decision_history\.bet_type/);
  assert.match(source, /rp\.combination = decision_history\.selection/);
  assert.doesNotMatch(source, /THEN current_odds ELSE 0 END AS payout_odds/);
  assert.match(source, /missing_payout_hits AS missingPayoutHits/);
  assert.match(source, /CASE WHEN missing_payout_hits = 0[\s\S]*?ELSE NULL[\s\S]*?END AS roi/);
  assert.match(source, /CASE WHEN missing_payout_hits = 0[\s\S]*?ELSE NULL[\s\S]*?END AS roiExMax/);
});

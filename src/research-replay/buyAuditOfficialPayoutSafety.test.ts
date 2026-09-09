import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-buy-audit.ts", "utf8");

test("buy audit uses a canonical read-only database boundary", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile/u);
  assert.match(source, /new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only = ON/u);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/u);
});

test("buy audit maps decision bet types and fail-closes official winning settlements", () => {
  assert.match(source, /function assertOfficialSettlementIntegrity/u);
  assert.match(source, /WHEN '3連単' THEN 'trifecta'/u);
  assert.match(source, /WHEN '3連複' THEN 'trio'/u);
  assert.match(source, /WHEN '2連単' THEN 'exacta'/u);
  assert.match(source, /WHEN '2連複' THEN 'quinella'/u);
  assert.match(source, /WHEN '拡連複' THEN 'wide'/u);
  assert.match(source, /s\.payout_bet_type IS NULL/u);
  assert.match(source, /SELECT COUNT\(\*\)[\s\S]*rp\.combination = s\.selection\) != 1/u);
  assert.match(source, /rp\.returned = 0[\s\S]*rp\.payout_yen > 0\) != 1/u);
});

test("buy audit rejects blank settled BUY results before ROI aggregation", () => {
  assert.match(source, /WITH blank_settled_buy AS/u);
  assert.match(source, /BUY_AUDIT_BLANK_SETTLED_RESULT_UNSUPPORTED/u);
  assert.match(source, /TRIM\(dh\.result\) = ''/u);
  assert.match(source, /TRIM\(dh\.result\) != ''/u);
  assert.match(source, /returned = 0 AND result IS NOT NULL AND TRIM\(result\) != ''/u);
  assert.doesNotMatch(source, /SUM\(CASE WHEN returned = 0 AND result IS NOT NULL THEN 1 ELSE 0 END\) AS settled_n/u);
});

test("buy audit ROI uses official payout units and only nonblank settled non-returned BUY rows", () => {
  assert.match(source, /roiSource: "official race_payouts\.payout_yen"/u);
  assert.match(source, /SELECT rp\.payout_yen \/ 100\.0/u);
  assert.match(source, /returned = 0 AND result IS NOT NULL AND TRIM\(result\) != ''/u);
  assert.match(source, /max_hit_payout_units/u);
  assert.doesNotMatch(source, /THEN current_odds ELSE 0 END\) \* 1\.0[\s\S]*AS roi/u);
});

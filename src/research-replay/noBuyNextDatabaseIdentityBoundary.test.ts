import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-no-buy-next.ts", "utf-8");

test("no-buy next research verifies primary DB identity before opening SQLite", () => {
  const verify = source.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0, "primary DB identity guard must exist");
  assert.ok(open > verify, "SQLite must open only after canonical identity verification");
});

test("no-buy next research keeps SQLite query-only and remains analysis-only", () => {
  assert.match(source, /PRAGMA query_only = ON/);
  assert.match(source, /readOnly: true/);
  assert.match(source, /これはedge候補であり、本物のedgeではありません/);
  assert.match(source, /本番採用しません/);
});

test("no-buy next research fails closed on return state and trifecta shape before settlement validation and ranking", () => {
  const returnedGate = source.indexOf("assertNoReturnedBuyRows();");
  const shapeGate = source.indexOf("assertCanonicalTrifectaShapes();");
  const settlementGate = source.indexOf("assertOfficialWinningSettlements();");
  const load = source.indexOf("const rows = loadRows();");
  assert.ok(returnedGate >= 0);
  assert.ok(shapeGate > returnedGate);
  assert.ok(settlementGate > shapeGate);
  assert.ok(load > settlementGate);
  assert.match(source, /dh\.returned IS NULL OR dh\.returned != 0/);
  assert.match(source, /NO_BUY_NEXT_RETURNED_BUY_UNSUPPORTED/);
  assert.match(source, /NO_BUY_NEXT_TRIFECTA_SHAPE_INVALID/);
  assert.match(source, /dh\.selection NOT GLOB '\[1-6\]-\[1-6\]-\[1-6\]'/);
  assert.match(source, /dh\.result NOT GLOB '\[1-6\]-\[1-6\]-\[1-6\]'/);
  assert.match(source, /substr\(dh\.selection,1,1\) = substr\(dh\.selection,3,1\)/);
  assert.match(source, /substr\(dh\.result,1,1\) = substr\(dh\.result,3,1\)/);
  assert.match(source, /dh\.returned = 0/);
});

test("no-buy next research scopes return, shape, settlement, and ROI cohorts to trifecta decisions", () => {
  const matches = source.match(/dh\.bet_type='3連単'/g) ?? [];
  assert.equal(matches.length, 4, "return gate, shape gate, settlement gate, and ROI load must share the same 3連単 decision cohort");
  assert.match(source, /rp\.bet_type = 'trifecta'/);
});

test("no-buy next ROI validates every settled denominator against its unique positive non-refund official trifecta winning result", () => {
  assert.match(source, /WITH settled AS/);
  assert.match(source, /SELECT DISTINCT dh\.race_id, dh\.result/);
  assert.match(source, /dh\.result != ''/);
  assert.doesNotMatch(source, /WITH winners AS/);
  assert.match(source, /rp\.bet_type = 'trifecta'/);
  assert.match(source, /rp\.combination = s\.result/);
  assert.match(source, /total_rows != 1 OR valid_rows != 1/);
  assert.match(source, /rp\.payout_yen IS NOT NULL/);
  assert.match(source, /NO_BUY_NEXT_OFFICIAL_SETTLEMENT_INVALID/);
  assert.match(source, /official_payout_yen/);
  assert.match(source, /const ret = rows\.reduce\(\(sum, row\) => sum \+ row\.payoutYen, 0\)/);
  assert.match(source, /roiExMaxHit: stake \? Math\.max\(0, ret - max\) \/ stake : 0/);
  assert.match(source, /returnSource: "official race_payouts"/);
  assert.match(source, /current_oddsは条件分類と平均オッズ表示にのみ使います/);
});

test("no-buy next does not expose configured database paths in missing-DB errors", () => {
  assert.match(source, /NO_BUY_NEXT_RESEARCH_DB_UNAVAILABLE/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
});

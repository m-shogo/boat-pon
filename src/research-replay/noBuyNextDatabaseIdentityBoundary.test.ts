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

test("no-buy next research fails closed on returned historical BUY rows before ranking", () => {
  const returnedGate = source.indexOf("assertNoReturnedBuyRows();");
  const settlementGate = source.indexOf("assertOfficialWinningSettlements();");
  const load = source.indexOf("const rows = loadRows();");
  assert.ok(returnedGate >= 0);
  assert.ok(settlementGate > returnedGate);
  assert.ok(load > settlementGate);
  assert.match(source, /dh\.returned != 0/);
  assert.match(source, /NO_BUY_NEXT_RETURNED_BUY_UNSUPPORTED/);
  assert.match(source, /dh\.returned = 0/);
});

test("no-buy next ROI uses unique positive non-refund official trifecta settlements", () => {
  assert.match(source, /rp\.bet_type = 'trifecta'/);
  assert.match(source, /rp\.combination = w\.selection/);
  assert.match(source, /total_rows != 1 OR valid_rows != 1/);
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

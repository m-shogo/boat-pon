import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-roi-hypothesis-sets.ts", "utf8");

test("ROI hypothesis analysis rejects unknown or returned historical BUY rows before settlement and raw analysis", () => {
  assert.match(source, /dh\.returned IS NULL OR dh\.returned != 0/);
  assert.match(source, /unknown or returned settlement state/);
  const returnGate = source.indexOf("const invalidReturn = db.prepare");
  const integrity = source.indexOf("WITH relevant_settled AS");
  const raw = source.indexOf("analyze-roi-hypothesis-sets-raw.ts");
  assert.ok(returnGate >= 0);
  assert.ok(integrity > returnGate);
  assert.ok(raw > integrity);
});

test("ROI hypothesis analysis maps decision 3連単 rows to canonical trifecta winning-result settlements", () => {
  assert.match(source, /const DECISION_BET_TYPE = "3連単"/);
  assert.match(source, /const PAYOUT_BET_TYPE = "trifecta"/);
  assert.match(source, /SELECT DISTINCT dh\.race_id, dh\.result/);
  assert.match(source, /dh\.bet_type = \?/);
  assert.match(source, /rp\.bet_type = \?/);
  assert.match(source, /\.get\(DECISION_BET_TYPE, PAYOUT_BET_TYPE, PAYOUT_BET_TYPE\)/);
  assert.match(source, /rp\.combination = s\.result/);
  assert.doesNotMatch(source, /rp\.bet_type = s\.bet_type/);
});

test("ROI hypothesis analysis fails closed on ambiguous settled denominator winning settlements", () => {
  assert.match(source, /COUNT\(\*\)[\s\S]*rp\.bet_type = \?[\s\S]*rp\.combination = s\.result/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen IS NOT NULL/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /settled denominator race\(s\) do not have exactly one positive non-refund official winning settlement/);
});

test("ROI hypothesis settlement gate runs read-only before raw analysis", () => {
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile");
  const queryOnly = source.indexOf("PRAGMA query_only = ON");
  const returnGate = source.indexOf("const invalidReturn = db.prepare");
  const integrity = source.indexOf("WITH relevant_settled AS");
  const raw = source.indexOf("analyze-roi-hypothesis-sets-raw.ts");
  assert.ok(identity >= 0 && queryOnly > identity && returnGate > queryOnly && integrity > returnGate && raw > integrity);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
});

test("ROI hypothesis gate validates one canonical winning settlement per settled race without collapsing distinct races", () => {
  assert.match(source, /SELECT DISTINCT dh\.race_id, dh\.result/);
  assert.match(source, /rp\.combination = s\.result/);
  assert.doesNotMatch(source, /GROUP BY\s+rp\.race_id\s*$/m);
});

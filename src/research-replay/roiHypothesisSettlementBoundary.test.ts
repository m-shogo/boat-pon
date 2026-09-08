import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-roi-hypothesis-sets.ts", "utf8");

test("ROI hypothesis analysis rejects unknown or returned historical BUY rows before settlement and raw analysis", () => {
  assert.match(source, /dh\.returned IS NULL OR dh\.returned != 0/);
  assert.match(source, /unknown or returned settlement state/);
  const returnGate = source.indexOf("const invalidReturn = db.prepare");
  const integrity = source.indexOf("WITH relevant_hits AS");
  const raw = source.indexOf("analyze-roi-hypothesis-sets-raw.ts");
  assert.ok(returnGate >= 0);
  assert.ok(integrity > returnGate);
  assert.ok(raw > integrity);
});

test("ROI hypothesis analysis maps decision 3連単 rows to canonical trifecta settlement keys", () => {
  assert.match(source, /const DECISION_BET_TYPE = "3連単"/);
  assert.match(source, /const PAYOUT_BET_TYPE = "trifecta"/);
  assert.match(source, /SELECT DISTINCT dh\.race_id, dh\.selection/);
  assert.match(source, /dh\.bet_type = \?/);
  assert.match(source, /rp\.bet_type = \?/);
  assert.match(source, /\.get\(DECISION_BET_TYPE, PAYOUT_BET_TYPE, PAYOUT_BET_TYPE\)/);
  assert.doesNotMatch(source, /rp\.bet_type = h\.bet_type/);
});

test("ROI hypothesis analysis fails closed on ambiguous winning settlement keys", () => {
  assert.match(source, /COUNT\(\*\)[\s\S]*rp\.bet_type = \?[\s\S]*rp\.combination = h\.selection/);
  assert.match(source, /rp\.returned = 0/);
  assert.match(source, /rp\.payout_yen > 0/);
  assert.match(source, /do not have exactly one positive non-refund official settlement/);
});

test("ROI hypothesis settlement gate runs read-only before raw analysis", () => {
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile");
  const queryOnly = source.indexOf("PRAGMA query_only = ON");
  const returnGate = source.indexOf("const invalidReturn = db.prepare");
  const integrity = source.indexOf("WITH relevant_hits AS");
  const raw = source.indexOf("analyze-roi-hypothesis-sets-raw.ts");
  assert.ok(identity >= 0 && queryOnly > identity && returnGate > queryOnly && integrity > returnGate && raw > integrity);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
});

test("ROI hypothesis gate preserves legitimate multi-line settlements across distinct combinations", () => {
  assert.match(source, /rp\.combination = h\.selection/);
  assert.doesNotMatch(source, /GROUP BY\s+rp\.race_id\s*$/m);
});

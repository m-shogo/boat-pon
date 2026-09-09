import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync("scripts/run-roi-full-review.ts", "utf8");
const gate = readFileSync("scripts/assert-roi-all-feature-settlement-integrity.ts", "utf8");

test("ROI full review verifies all-feature settlement integrity before search and verdict generation", () => {
  const integrityCommand = runner.indexOf('["pnpm", ["tsx", "scripts/assert-roi-all-feature-settlement-integrity.ts"]]');
  const searchCommand = runner.indexOf('["pnpm", ["tsx", "scripts/search-roi-all-features-lite.ts"]]');
  const finalDecision = runner.indexOf("const finalDecision = decide(");
  assert.ok(integrityCommand >= 0);
  assert.ok(searchCommand > integrityCommand);
  assert.ok(finalDecision > searchCommand);
});

test("all-feature settlement gate rejects unknown or returned historical BUY rows before official payout integrity", () => {
  assert.match(gate, /returned IS NULL OR returned != 0/);
  assert.match(gate, /ROI_ALL_FEATURE_RETURN_STATE_INVALID/);
  const returnGate = gate.indexOf("const invalidReturn = db.prepare");
  const settlementGate = gate.indexOf("WITH relevant_settled AS");
  assert.ok(returnGate >= 0);
  assert.ok(settlementGate > returnGate);
});

test("all-feature settlement gate is canonical, read-only, query-only, and validates every settled 3連単 denominator against trifecta winning results", () => {
  assert.match(gate, /assertCanonicalSingleLinkRegularFile\(/);
  assert.match(gate, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(gate, /PRAGMA query_only = ON/);
  assert.match(gate, /const DECISION_BET_TYPE = "3連単"/);
  assert.match(gate, /const PAYOUT_BET_TYPE = "trifecta"/);
  assert.match(gate, /WITH relevant_settled AS/);
  assert.match(gate, /SELECT DISTINCT race_id, result/);
  assert.match(gate, /run_kind = 'historical-backfill'/);
  assert.match(gate, /decision = 'BUY'/);
  assert.match(gate, /bet_type = \?/);
  assert.match(gate, /returned = 0/);
  assert.doesNotMatch(gate, /selection = result/);
  assert.match(gate, /rp\.bet_type = \?/);
  assert.match(gate, /rp\.combination = s\.result/);
  assert.match(gate, /\.get\(DECISION_BET_TYPE, PAYOUT_BET_TYPE, PAYOUT_BET_TYPE\)/);
  assert.doesNotMatch(gate, /rp\.bet_type = s\.bet_type/);
  assert.match(gate, /\) != 1/);
  assert.match(gate, /rp\.returned = 0/);
  assert.match(gate, /rp\.payout_yen IS NOT NULL/);
  assert.match(gate, /rp\.payout_yen > 0/);
  assert.match(gate, /ROI_ALL_FEATURE_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
});

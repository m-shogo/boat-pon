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

test("all-feature settlement gate is canonical, read-only, query-only, and maps decision 3連単 to trifecta", () => {
  assert.match(gate, /assertCanonicalSingleLinkRegularFile\(/);
  assert.match(gate, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(gate, /PRAGMA query_only = ON/);
  assert.match(gate, /const DECISION_BET_TYPE = "3連単"/);
  assert.match(gate, /const PAYOUT_BET_TYPE = "trifecta"/);
  assert.match(gate, /SELECT DISTINCT race_id, selection/);
  assert.match(gate, /run_kind = 'historical-backfill'/);
  assert.match(gate, /decision = 'BUY'/);
  assert.match(gate, /bet_type = \?/);
  assert.match(gate, /selection = result/);
  assert.match(gate, /rp\.bet_type = \?/);
  assert.match(gate, /rp\.combination = h\.selection/);
  assert.match(gate, /\.get\(DECISION_BET_TYPE, PAYOUT_BET_TYPE, PAYOUT_BET_TYPE\)/);
  assert.doesNotMatch(gate, /rp\.bet_type = h\.bet_type/);
  assert.match(gate, /\) != 1/);
  assert.match(gate, /rp\.returned = 0/);
  assert.match(gate, /rp\.payout_yen > 0/);
  assert.match(gate, /ROI_ALL_FEATURE_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED/);
});

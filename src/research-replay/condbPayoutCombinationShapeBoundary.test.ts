import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const preflight = readFileSync("scripts/audit-condb-switch-historical-payout-completeness.ts", "utf8");

test("condB historical switch rejects malformed official trifecta payout keys before coverage", () => {
  const shapeGate = preflight.indexOf("payoutCombinationShape");
  const coverage = preflight.indexOf("const row = db.prepare");

  assert.ok(shapeGate >= 0, "payout combination shape gate must exist");
  assert.ok(coverage > shapeGate, "settlement coverage must remain downstream of payout-key validation");
  assert.match(preflight, /rp\.combination NOT GLOB '\[1-6\]-\[1-6\]-\[1-6\]'/);
  assert.match(preflight, /substr\(rp\.combination, 1, 1\) = substr\(rp\.combination, 3, 1\)/);
  assert.match(preflight, /substr\(rp\.combination, 1, 1\) = substr\(rp\.combination, 5, 1\)/);
  assert.match(preflight, /substr\(rp\.combination, 3, 1\) = substr\(rp\.combination, 5, 1\)/);
  assert.match(preflight, /CONDB_SWITCH_HISTORICAL_PAYOUT_COMBINATION_INVALID/);
});

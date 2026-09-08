import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-motor-filter-consistency.ts", "utf8");

test("motor filter report rejects unknown or returned historical BUY rows before settlement and analysis", () => {
  assert.match(source, /function assertReturnStateIntegrity\(\)/u);
  assert.match(source, /returned IS NULL OR returned != 0/u);
  assert.match(source, /MOTOR_FILTER_RETURN_STATE_INVALID/u);

  const returnGate = source.indexOf("assertReturnStateIntegrity();");
  const settlementGate = source.indexOf("assertWinningSettlementIntegrity();");
  const loadRows = source.indexOf("const rows = loadRows();");

  assert.ok(returnGate >= 0, "return-state guard must run");
  assert.ok(settlementGate > returnGate, "settlement integrity must run after return-state integrity");
  assert.ok(loadRows > settlementGate, "analysis population must load only after both fail-closed guards");
});

test("motor filter analysis population remains fixed to non-returned historical BUY rows", () => {
  assert.match(source, /WHERE dh\.run_kind='historical-backfill'[\s\S]*AND dh\.decision='BUY'[\s\S]*AND dh\.bet_type = \?[\s\S]*AND dh\.returned = 0/u);
});

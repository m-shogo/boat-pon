import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-calibration-stability.ts", "utf8");

test("calibration stability rejects unknown or returned historical BUY rows before settlement analysis", () => {
  assert.match(source, /returned IS NULL OR returned != 0/);
  assert.match(source, /CALIBRATION_STABILITY_RETURN_STATE_INVALID/);
  const returnGate = source.indexOf("assertReturnStateIntegrity();");
  const settlementGate = source.indexOf("assertOfficialSettlementIntegrity();");
  const rawRows = source.indexOf("const rows = db.prepare");
  assert.ok(returnGate >= 0);
  assert.ok(settlementGate > returnGate);
  assert.ok(rawRows > settlementGate);
});

test("calibration stability keeps the evaluated population fixed to non-returned rows", () => {
  assert.match(source, /AND result IS NOT NULL AND result!='' AND returned=0 AND current_odds IS NOT NULL/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
});

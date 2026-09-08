import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-calibration-stability.ts", "utf8");
const auditSource = readFileSync("scripts/audit-calibration-stability-payout-completeness.ts", "utf8");

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

test("calibration stability direct payout audit rejects invalid return state before settlement integrity", () => {
  assert.match(auditSource, /returned IS NULL OR returned != 0/);
  assert.match(auditSource, /CALIBRATION_STABILITY_RETURN_STATE_INVALID/);
  const returnGate = auditSource.indexOf("const invalidReturn = db.prepare");
  const settlementGate = auditSource.indexOf("const duplicateOrInvalid = db.prepare");
  const population = auditSource.indexOf("WITH population AS");
  assert.ok(returnGate >= 0);
  assert.ok(settlementGate > returnGate);
  assert.ok(population > settlementGate);
});

test("calibration stability keeps the evaluated population fixed to non-returned rows", () => {
  assert.match(source, /AND result IS NOT NULL AND result!='' AND returned=0 AND current_odds IS NOT NULL/);
  assert.match(auditSource, /AND dh.returned=0/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(auditSource, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(auditSource, /PRAGMA query_only = ON/);
});

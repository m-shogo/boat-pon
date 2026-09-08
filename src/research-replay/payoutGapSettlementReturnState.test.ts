import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const audit = readFileSync("scripts/audit-odds-payout-gap-completeness.ts", "utf8");

test("payout-gap preflight rejects refunded or unknown settlement return states", () => {
  assert.match(audit, /ts\.returned IS NULL OR ts\.returned != 0/);
  assert.match(audit, /invalidSettlementReturnRows/);
  assert.match(audit, /refunded or unknown-return trifecta settlement rows/);
});

test("settlement return-state gate runs before payout verdict availability", () => {
  const returnGate = audit.indexOf("if ((row.invalidSettlementReturnRows ?? 0) > 0)");
  const winningKeyGate = audit.indexOf("if ((row.invalidWinningKeys ?? 0) > 0)");
  const coverageGate = audit.indexOf("if (!result.complete)");

  assert.ok(returnGate >= 0);
  assert.ok(winningKeyGate > returnGate);
  assert.ok(coverageGate > returnGate);
});

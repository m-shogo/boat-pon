import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const audit = readFileSync("scripts/audit-roi-skip-policy-payout-completeness.ts", "utf8");

test("ROI skip-policy rejects malformed official trifecta settlement keys", () => {
  assert.match(audit, /invalidSettlementKeyShapes/);
  assert.match(audit, /ts\.combination IS NULL/);
  assert.match(audit, /length\(ts\.combination\) != 5/);
  assert.match(audit, /ts\.combination NOT GLOB '\[1-6\]-\[1-6\]-\[1-6\]'/);
  assert.match(audit, /substr\(ts\.combination, 1, 1\) = substr\(ts\.combination, 3, 1\)/);
  assert.match(audit, /substr\(ts\.combination, 1, 1\) = substr\(ts\.combination, 5, 1\)/);
  assert.match(audit, /substr\(ts\.combination, 3, 1\) = substr\(ts\.combination, 5, 1\)/);

  const shapeGuard = audit.indexOf("if ((row.invalidSettlementKeyShapes ?? 0) > 0)");
  const payoutGuard = audit.indexOf("if ((row.invalidNonRefundRows ?? 0) > 0)");
  const duplicateGuard = audit.indexOf("if ((row.duplicateCombinationKeys ?? 0) > 0)");
  const returnGuard = audit.indexOf("if ((row.returnedRows ?? 0) > 0)");
  const completenessGuard = audit.indexOf("if (!result.complete)");

  assert.ok(shapeGuard >= 0, "official settlement shape guard must exist");
  assert.ok(payoutGuard > shapeGuard, "payout-value validation must remain downstream of settlement-key shape");
  assert.ok(duplicateGuard > shapeGuard, "duplicate-key verdict must remain downstream of settlement-key shape");
  assert.ok(returnGuard > shapeGuard, "return-state verdict must remain downstream of settlement-key shape");
  assert.ok(completenessGuard > shapeGuard, "coverage verdict must remain downstream of settlement-key shape");
  assert.match(audit, /malformed official trifecta settlement keys; skip-policy payout ROI and policy verdicts must remain unavailable/);
});

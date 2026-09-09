import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const audit = readFileSync("scripts/audit-roi-edge-market-gap-payout-completeness.ts", "utf8");

test("ROI edge market-gap rejects malformed historical trifecta results before verdicts", () => {
  assert.match(audit, /SELECT dh\.race_id, dh\.bet_type, dh\.returned, dh\.result/);
  assert.match(audit, /invalidResultKeyShapes/);
  assert.match(audit, /length\(tr\.result\) != 5/);
  assert.match(audit, /tr\.result NOT GLOB '\[1-6\]-\[1-6\]-\[1-6\]'/);
  assert.match(audit, /substr\(tr\.result, 1, 1\) = substr\(tr\.result, 3, 1\)/);
  assert.match(audit, /substr\(tr\.result, 1, 1\) = substr\(tr\.result, 5, 1\)/);
  assert.match(audit, /substr\(tr\.result, 3, 1\) = substr\(tr\.result, 5, 1\)/);

  const shapeGuard = audit.indexOf("if ((row.invalidResultKeyShapes ?? 0) > 0)");
  const settlementGuard = audit.indexOf("if ((row.invalidNonRefundRows ?? 0) > 0)");
  const completenessGuard = audit.indexOf("if (!result.complete)");

  assert.ok(shapeGuard >= 0, "result shape guard must exist");
  assert.ok(settlementGuard > shapeGuard, "settlement verdict must remain downstream of result-shape validation");
  assert.ok(completenessGuard > shapeGuard, "coverage verdict must remain downstream of result-shape validation");
  assert.match(audit, /hit-rate, market-gap, missed-opportunity ROI, and edge\/skip verdicts must remain unavailable/);
});

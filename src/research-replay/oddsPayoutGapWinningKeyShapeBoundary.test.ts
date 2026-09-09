import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const preflight = readFileSync("scripts/audit-odds-payout-gap-completeness.ts", "utf8");

test("odds payout gap and payout rebase reject malformed historical trifecta winning keys", () => {
  assert.match(preflight, /invalidWinningKeyShapes/);
  assert.match(preflight, /length\(tr\.result\) != 5/);
  assert.match(preflight, /tr\.result NOT GLOB '\[1-6\]-\[1-6\]-\[1-6\]'/);
  assert.match(preflight, /substr\(tr\.result, 1, 1\) = substr\(tr\.result, 3, 1\)/);
  assert.match(preflight, /substr\(tr\.result, 1, 1\) = substr\(tr\.result, 5, 1\)/);
  assert.match(preflight, /substr\(tr\.result, 3, 1\) = substr\(tr\.result, 5, 1\)/);

  const shapeGuard = preflight.indexOf("if ((row.invalidWinningKeyShapes ?? 0) > 0)");
  const exactKeyGuard = preflight.indexOf("if ((row.invalidWinningKeys ?? 0) > 0)");
  const completenessGuard = preflight.indexOf("if (!result.complete)");

  assert.ok(shapeGuard >= 0, "winning-key shape guard must exist");
  assert.ok(exactKeyGuard > shapeGuard, "exact payout-key matching must remain downstream of result-shape validation");
  assert.ok(completenessGuard > shapeGuard, "coverage verdict must remain downstream of result-shape validation");
  assert.match(preflight, /payout rebase must remain unavailable/);
});

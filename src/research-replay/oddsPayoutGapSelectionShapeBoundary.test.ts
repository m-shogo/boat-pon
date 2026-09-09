import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const preflight = readFileSync("scripts/audit-odds-payout-gap-completeness.ts", "utf8");

test("odds payout gap and payout rebase reject malformed historical trifecta selections", () => {
  assert.match(preflight, /SELECT dh\.race_id, dh\.bet_type, dh\.returned, dh\.selection, dh\.result/);
  assert.match(preflight, /invalidSelectionKeyShapes/);
  assert.match(preflight, /tr\.selection IS NULL/);
  assert.match(preflight, /length\(tr\.selection\) != 5/);
  assert.match(preflight, /tr\.selection NOT GLOB '\[1-6\]-\[1-6\]-\[1-6\]'/);
  assert.match(preflight, /substr\(tr\.selection, 1, 1\) = substr\(tr\.selection, 3, 1\)/);
  assert.match(preflight, /substr\(tr\.selection, 1, 1\) = substr\(tr\.selection, 5, 1\)/);
  assert.match(preflight, /substr\(tr\.selection, 3, 1\) = substr\(tr\.selection, 5, 1\)/);

  const selectionGuard = preflight.indexOf("if ((row.invalidSelectionKeyShapes ?? 0) > 0)");
  const winningShapeGuard = preflight.indexOf("if ((row.invalidWinningKeyShapes ?? 0) > 0)");
  const exactKeyGuard = preflight.indexOf("if ((row.invalidWinningKeys ?? 0) > 0)");

  assert.ok(selectionGuard >= 0, "selection shape guard must exist");
  assert.ok(winningShapeGuard > selectionGuard, "winning-result validation must remain downstream of selection validation");
  assert.ok(exactKeyGuard > selectionGuard, "exact payout-key matching must remain downstream of selection validation");
  assert.match(preflight, /substring-based condition analysis and exact-key payout ROI must remain unavailable/);
});

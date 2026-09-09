import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const audit = readFileSync("scripts/audit-odds-payout-gap-completeness.ts", "utf8");

test("odds payout gap and payout rebase reject malformed official trifecta settlement keys", () => {
  assert.match(audit, /invalidSettlementKeyShapes/);
  assert.match(audit, /ts\.combination IS NULL/);
  assert.match(audit, /length\(ts\.combination\) != 5/);
  assert.match(audit, /ts\.combination NOT GLOB '\[1-6\]-\[1-6\]-\[1-6\]'/);
  assert.match(audit, /substr\(ts\.combination, 1, 1\) = substr\(ts\.combination, 3, 1\)/);
  assert.match(audit, /substr\(ts\.combination, 1, 1\) = substr\(ts\.combination, 5, 1\)/);
  assert.match(audit, /substr\(ts\.combination, 3, 1\) = substr\(ts\.combination, 5, 1\)/);

  const winningShapeGuard = audit.indexOf("if ((row.invalidWinningKeyShapes ?? 0) > 0)");
  const settlementShapeGuard = audit.indexOf("if ((row.invalidSettlementKeyShapes ?? 0) > 0)");
  const payoutGuard = audit.indexOf("if ((row.invalidNonRefundRows ?? 0) > 0)");
  const exactKeyGuard = audit.indexOf("if ((row.invalidWinningKeys ?? 0) > 0)");
  const completenessGuard = audit.indexOf("if (!result.complete)");

  assert.ok(settlementShapeGuard > winningShapeGuard, "official settlement shape must be checked after historical winning-key shape");
  assert.ok(payoutGuard > settlementShapeGuard, "payout-value validation must remain downstream of settlement-key shape");
  assert.ok(exactKeyGuard > settlementShapeGuard, "exact winning-key verdict must remain downstream of settlement-key shape");
  assert.ok(completenessGuard > settlementShapeGuard, "coverage verdict must remain downstream of settlement-key shape");
  assert.match(audit, /malformed official trifecta settlement keys; exact-key payout ROI and payout rebase must remain unavailable/);
});

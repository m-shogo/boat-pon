import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePaperForwardPayoutCompleteness } from "./paperForwardPayoutCompleteness";

test("paper-forward payout completeness passes only at 100% non-empty coverage", () => {
  assert.deepEqual(evaluatePaperForwardPayoutCompleteness(4, 4), {
    totalRaces: 4,
    coveredRaces: 4,
    missingRaces: 0,
    coverageRate: 100,
    complete: true,
  });

  assert.deepEqual(evaluatePaperForwardPayoutCompleteness(4, 3), {
    totalRaces: 4,
    coveredRaces: 3,
    missingRaces: 1,
    coverageRate: 75,
    complete: false,
  });

  assert.equal(evaluatePaperForwardPayoutCompleteness(0, 0).complete, false);
});

test("paper-forward payout completeness rejects impossible counts", () => {
  assert.throws(() => evaluatePaperForwardPayoutCompleteness(-1, 0));
  assert.throws(() => evaluatePaperForwardPayoutCompleteness(1, 2));
  assert.throws(() => evaluatePaperForwardPayoutCompleteness(1.5, 1));
});

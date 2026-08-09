import assert from "node:assert/strict";
import test from "node:test";
import { validatePromotion } from "./contracts";

const base = {
  promotionId: "PROMO-approval-evidence",
  strategyId: "STRAT-market-resid",
  fromVersion: "v1.0",
  toState: "active_research" as const,
  transferExperimentIds: ["XFER-0001"],
  evidenceDigests: [],
  productionConnection: false as const,
  createdAt: "2026-08-09T00:00:00Z",
};

test("approved promotions require attributable human approval evidence", () => {
  assert.equal(validatePromotion({
    ...base,
    humanApproval: { approved: true, approver: null, approvedAt: "2026-08-09T00:00:00Z", note: "approved" },
  }).valid, false);

  assert.equal(validatePromotion({
    ...base,
    humanApproval: { approved: true, approver: "m-shogo", approvedAt: null, note: "approved" },
  }).valid, false);

  assert.equal(validatePromotion({
    ...base,
    humanApproval: { approved: true, approver: "m-shogo", approvedAt: "2026-08-09T00:00:00Z", note: "approved" },
  }).valid, true);
});

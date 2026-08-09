import assert from "node:assert/strict";
import test from "node:test";
import { validatePromotion } from "./contracts";

const basePromotion = {
  promotionId: "PROMO-guard-1",
  strategyId: "STRAT-market-resid",
  fromVersion: "v1.0",
  toState: "candidate",
  transferExperimentIds: [] as string[],
  evidenceDigests: [] as string[],
  humanApproval: { approved: false, approver: null, approvedAt: null, note: "" },
  productionConnection: false,
  createdAt: "2026-08-10T00:00:00Z",
};

test("promotion rejects cross-namespace transfer ids before append", () => {
  assert.equal(validatePromotion(basePromotion).valid, true);
  const invalid = validatePromotion({ ...basePromotion, transferExperimentIds: ["EXP-wrong-namespace"] });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.includes("XFER-*")));
});

test("promotion requires intrinsic provenance arrays and fromVersion", () => {
  assert.equal(validatePromotion({ ...basePromotion, fromVersion: "" }).valid, false);
  assert.equal(validatePromotion({ ...basePromotion, transferExperimentIds: null }).valid, false);
  assert.equal(validatePromotion({ ...basePromotion, evidenceDigests: null }).valid, false);
});

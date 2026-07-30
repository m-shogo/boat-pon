import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyEligibility,
  deriveBetLabel,
  validateFeaturePIT,
  validateOddsUsage,
  type CandidateEligibilityInput,
} from "./n2DatasetContract";

const CUTOFF = "2026-05-20T05:00:00.000Z";

function elig(over: Partial<CandidateEligibilityInput>) {
  return classifyEligibility({ settlementStatus: "settled", resolutionStatus: "resolved", isSourceDuplicate: false, ...over });
}

test("eligibility: canonical settled resolved is eligible", () => {
  assert.deepEqual(elig({}), { eligible: true, reason: "eligible" });
  assert.deepEqual(elig({ settlementStatus: "partially_refunded" }), { eligible: true, reason: "eligible" });
});

test("eligibility: unsettled/cancelled/refunded/no_sale are excluded with reasons (not loss)", () => {
  assert.deepEqual(elig({ settlementStatus: "pending" }), { eligible: false, reason: "excluded_unsettled" });
  assert.deepEqual(elig({ settlementStatus: "cancelled" }), { eligible: false, reason: "excluded_cancelled" });
  assert.deepEqual(elig({ settlementStatus: "refunded" }), { eligible: false, reason: "excluded_refunded" });
  assert.deepEqual(elig({ settlementStatus: "no_sale" }), { eligible: false, reason: "excluded_no_sale" });
});

test("eligibility: conflict/unresolved/source_duplicate fail closed", () => {
  assert.equal(elig({ resolutionStatus: "source_conflict" }).reason, "excluded_conflict");
  assert.equal(elig({ resolutionStatus: "unresolved" }).reason, "excluded_unresolved");
  assert.equal(elig({ resolutionStatus: "quarantined" }).reason, "excluded_unresolved");
  assert.equal(elig({ isSourceDuplicate: true }).reason, "excluded_source_duplicate");
});

test("target: hit/miss/payout derived only from canonical winning selections; ineligible → null (never loss)", () => {
  const eligible = { eligible: true, reason: "eligible" as const };
  const hit = deriveBetLabel({ eligibility: eligible, betSelection: "1-2-3", winningSelections: ["1-2-3"], payoutYenBySelection: { "1-2-3": 4200 } });
  assert.deepEqual(hit, { eligible: true, reason: "eligible", hit: 1, payoutYenPer100: 4200 });
  const miss = deriveBetLabel({ eligibility: eligible, betSelection: "1-2-4", winningSelections: ["1-2-3"], payoutYenBySelection: { "1-2-3": 4200 } });
  assert.deepEqual(miss, { eligible: true, reason: "eligible", hit: 0, payoutYenPer100: 0 });
  // 同着など複数 winning
  const multi = deriveBetLabel({ eligibility: eligible, betSelection: "2-3", winningSelections: ["1-2", "2-3"], payoutYenBySelection: { "1-2": 150, "2-3": 200 } });
  assert.equal(multi.hit, 1);
  assert.equal(multi.payoutYenPer100, 200);
  // ineligible → null（loss ではない）
  const inelig = deriveBetLabel({ eligibility: { eligible: false, reason: "excluded_refunded" }, betSelection: "1-2-3", winningSelections: [], payoutYenBySelection: {} });
  assert.deepEqual(inelig, { eligible: false, reason: "excluded_refunded", hit: null, payoutYenPer100: null });
});

test("feature PIT: available_at boundary is inclusive at cutoff, future rejected, unknown fail-closed", () => {
  const base = { featureKey: "nationalWinRate", pitClass: "historical_safe" as const };
  assert.equal(validateFeaturePIT({ ...base, availableAt: "2026-05-20T04:59:00.000Z" }, CUTOFF, "historical").usable, true);
  assert.equal(validateFeaturePIT({ ...base, availableAt: CUTOFF }, CUTOFF, "historical").usable, true); // == inclusive
  const future = validateFeaturePIT({ ...base, availableAt: "2026-05-20T05:00:00.001Z" }, CUTOFF, "historical");
  assert.equal(future.usable, false);
  assert.equal(future.reason, "excluded_pit_after_cutoff");
  const unknown = validateFeaturePIT({ featureKey: "x", pitClass: "unknown", availableAt: null }, CUTOFF, "historical");
  assert.equal(unknown.usable, false);
  assert.equal(unknown.reason, "excluded_pit_unknown_availability");
});

test("feature PIT: live-only features rejected in historical mode, allowed in live", () => {
  const f = { featureKey: "courseAvgSt", pitClass: "live_only" as const, availableAt: "2026-05-20T04:00:00.000Z" };
  assert.equal(validateFeaturePIT(f, CUTOFF, "historical").reason, "excluded_live_only_in_historical");
  assert.equal(validateFeaturePIT(f, CUTOFF, "live").usable, true);
});

test("adversarial: post-race/future/closing odds as feature are rejected", () => {
  // future settlement-derived feature as of after cutoff
  assert.equal(validateFeaturePIT({ featureKey: "raceResult", pitClass: "historical_safe", availableAt: "2026-05-20T06:00:00.000Z" }, CUTOFF, "historical").usable, false);
  // closing odds as training feature
  assert.equal(validateOddsUsage("closing", "feature").usable, false);
  assert.equal(validateOddsUsage("post_race_imputed", "feature").usable, false);
  // closing odds as evaluation is allowed (price evaluation only)
  assert.equal(validateOddsUsage("closing", "evaluation").usable, true);
  // live checkpoint before cutoff usable as feature
  assert.equal(validateOddsUsage("live_checkpoint", "feature").usable, true);
});

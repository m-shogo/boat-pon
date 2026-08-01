import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyEligibility,
  deriveBetLabel,
  deriveSelectionLevelLabels,
  enumerateBetSelections,
  N2_SELECTION_COUNT_BY_BET_TYPE,
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
  assert.deepEqual(hit, { eligible: true, reason: "eligible", outcome: "hit", hit: 1, payoutYenPer100: 4200 });
  const miss = deriveBetLabel({ eligibility: eligible, betSelection: "1-2-4", winningSelections: ["1-2-3"], payoutYenBySelection: { "1-2-3": 4200 } });
  assert.deepEqual(miss, { eligible: true, reason: "eligible", outcome: "loss", hit: 0, payoutYenPer100: 0 });
  // 同着など複数 winning
  const multi = deriveBetLabel({ eligibility: eligible, betSelection: "2-3", winningSelections: ["1-2", "2-3"], payoutYenBySelection: { "1-2": 150, "2-3": 200 } });
  assert.equal(multi.hit, 1);
  assert.equal(multi.payoutYenPer100, 200);
  // ineligible → null（loss ではない）
  const inelig = deriveBetLabel({ eligibility: { eligible: false, reason: "excluded_refunded" }, betSelection: "1-2-3", winningSelections: [], payoutYenBySelection: {} });
  assert.deepEqual(inelig, { eligible: false, reason: "excluded_refunded", outcome: "void", hit: null, payoutYenPer100: null });
});

test("target: partial refund and special payout are financial outcomes, never classification losses", () => {
  const eligible = { eligible: true, reason: "eligible" as const };
  const refunded = deriveBetLabel({
    eligibility: eligible,
    betSelection: "1-2-4",
    winningSelections: ["1-2-3"],
    payoutYenBySelection: { "1-2-3": 4200 },
    refundedSelections: ["1-2-4"],
    refundYenBySelection: { "1-2-4": 100 },
  });
  assert.deepEqual(refunded, {
    eligible: true,
    reason: "eligible",
    outcome: "refund",
    hit: null,
    payoutYenPer100: 100,
  });

  const special = deriveBetLabel({
    eligibility: eligible,
    betSelection: "3-5",
    winningSelections: [],
    payoutYenBySelection: {},
    specialPayoutYenPer100: 70,
  });
  assert.deepEqual(special, {
    eligible: true,
    reason: "eligible",
    outcome: "special_payout",
    hit: null,
    payoutYenPer100: 70,
  });

  const unknownRefundAmount = deriveBetLabel({
    eligibility: eligible,
    betSelection: "2",
    winningSelections: [],
    payoutYenBySelection: {},
    refundedSelections: ["2"],
  });
  assert.equal(unknownRefundAmount.outcome, "refund");
  assert.equal(unknownRefundAmount.hit, null);
  assert.equal(unknownRefundAmount.payoutYenPer100, null);
});

test("selection space: 7 bet types enumerate exactly 212 unique canonical selections", () => {
  const expected = {
    win: 6,
    place: 6,
    exacta: 30,
    quinella: 15,
    trifecta: 120,
    trio: 20,
    wide: 15,
  } as const;
  let total = 0;
  for (const [betType, count] of Object.entries(expected)) {
    const selections = enumerateBetSelections(betType as keyof typeof expected);
    assert.equal(selections.length, count);
    assert.equal(new Set(selections).size, count);
    assert.equal(N2_SELECTION_COUNT_BY_BET_TYPE[betType as keyof typeof expected], count);
    total += selections.length;
  }
  assert.equal(total, 212);
  assert.deepEqual(enumerateBetSelections("win"), ["1", "2", "3", "4", "5", "6"]);
  assert.equal(enumerateBetSelections("exacta").includes("2-1"), true);
  assert.equal(enumerateBetSelections("quinella").includes("2-1"), false);
  assert.equal(enumerateBetSelections("quinella").includes("1-2"), true);
  assert.equal(enumerateBetSelections("trifecta").includes("1-1-2"), false);
  assert.equal(enumerateBetSelections("trio").every((selection) => {
    const boats = selection.split("-").map(Number);
    return boats[0] < boats[1] && boats[1] < boats[2];
  }), true);
});

test("selection-level labels: every exacta selection passes deriveBetLabel with exhaustive outcomes", () => {
  const eligibility = { eligible: true, reason: "eligible" as const };
  const normal = deriveSelectionLevelLabels({
    betType: "exacta",
    eligibility,
    winningSelections: ["1-2"],
    payoutYenBySelection: { "1-2": 500 },
  });
  assert.equal(normal.length, 30);
  assert.equal(normal.filter((row) => row.outcome === "hit").length, 1);
  assert.equal(normal.filter((row) => row.outcome === "loss").length, 29);
  assert.equal(normal.find((row) => row.betSelection === "1-2")?.payoutYenPer100, 500);

  const partial = deriveSelectionLevelLabels({
    betType: "exacta",
    eligibility,
    winningSelections: ["1-2"],
    payoutYenBySelection: { "1-2": 500 },
    refundedSelections: ["2-1"],
    refundYenBySelection: { "2-1": 100 },
  });
  assert.deepEqual(
    Object.fromEntries(["hit", "loss", "refund"].map((outcome) => [
      outcome,
      partial.filter((row) => row.outcome === outcome).length,
    ])),
    { hit: 1, loss: 28, refund: 1 },
  );
  assert.equal(partial.find((row) => row.betSelection === "2-1")?.hit, null);

  const special = deriveSelectionLevelLabels({
    betType: "exacta",
    eligibility,
    winningSelections: [],
    payoutYenBySelection: {},
    specialPayoutYenPer100: 70,
  });
  assert.equal(special.every((row) =>
    row.outcome === "special_payout" && row.hit === null && row.payoutYenPer100 === 70), true);

  const voided = deriveSelectionLevelLabels({
    betType: "exacta",
    eligibility: { eligible: false, reason: "excluded_refunded" },
    winningSelections: [],
    payoutYenBySelection: {},
  });
  assert.equal(voided.every((row) =>
    row.outcome === "void" && row.hit === null && row.payoutYenPer100 === null), true);
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

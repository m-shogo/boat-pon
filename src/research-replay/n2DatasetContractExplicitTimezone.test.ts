import assert from "node:assert/strict";
import test from "node:test";
import { validateFeaturePIT, validateOddsUsage } from "./n2DatasetContract";

const CUTOFF = "2028-02-29T05:00:00.000Z";
const FEATURE = { featureKey: "nationalWinRate", pitClass: "historical_safe" as const };

test("core feature PIT rejects timezone-less timestamps", () => {
  for (const availableAt of ["2028-02-29", "2028-02-29T04:59:00", "2028-02-29 04:59:00Z"]) {
    assert.deepEqual(validateFeaturePIT({ ...FEATURE, availableAt }, CUTOFF, "historical"), {
      featureKey: FEATURE.featureKey,
      usable: false,
      reason: "excluded_pit_unknown_availability",
    });
  }
  assert.equal(validateFeaturePIT(
    { ...FEATURE, availableAt: "2028-02-29T04:59:00.000Z" },
    "2028-02-29T05:00:00",
    "historical",
  ).reason, "excluded_pit_unknown_availability");
});

test("core feature PIT rejects normalized invalid clocks and calendar dates", () => {
  for (const availableAt of [
    "2026-02-30T04:59:00.000Z",
    "2028-02-29T24:00:00.000Z",
    "2028-02-29T23:60:00Z",
    "2028-02-29T23:59:60Z",
  ]) {
    assert.equal(validateFeaturePIT({ ...FEATURE, availableAt }, CUTOFF, "historical").reason,
      "excluded_pit_unknown_availability");
  }
});

test("core feature PIT preserves valid explicit offsets", () => {
  assert.deepEqual(validateFeaturePIT(
    { ...FEATURE, availableAt: "2028-02-29T13:59:00+09:00" },
    "2028-02-29T14:00:00+09:00",
    "historical",
  ), { featureKey: FEATURE.featureKey, usable: true, reason: "pit_safe" });
});

test("core live odds rejects timezone-less timestamps atomically", () => {
  const base = {
    kind: "live_checkpoint" as const,
    role: "feature" as const,
    capturedAt: "2028-02-29T04:59:30.000Z",
    availableAt: "2028-02-29T04:59:00.000Z",
    decisionCutoff: CUTOFF,
  };
  assert.equal(validateOddsUsage({ ...base, capturedAt: "2028-02-29T04:59:30" }).reason,
    "excluded_odds_unknown_timestamp");
  assert.equal(validateOddsUsage({ ...base, availableAt: "2028-02-29T04:59:00" }).reason,
    "excluded_odds_unknown_timestamp");
  assert.equal(validateOddsUsage({ ...base, decisionCutoff: "2028-02-29T05:00:00" }).reason,
    "excluded_odds_unknown_timestamp");
});

test("core live odds preserves valid explicit offsets", () => {
  assert.deepEqual(validateOddsUsage({
    kind: "live_checkpoint",
    role: "feature",
    capturedAt: "2028-02-29T13:59:30+09:00",
    availableAt: "2028-02-29T13:59:00+09:00",
    decisionCutoff: "2028-02-29T14:00:00+09:00",
  }), { usable: true, reason: "odds_safe" });
});

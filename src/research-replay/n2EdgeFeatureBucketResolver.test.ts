import assert from "node:assert/strict";
import test from "node:test";

import { resolveN2EdgeFeatureBucket } from "./n2EdgeFeatureBucketResolver";

const cutoff = "2022-01-01T03:30:00.000Z";

test("course bucket is derived from locked selection role", () => {
  assert.deepEqual(resolveN2EdgeFeatureBucket({
    featureKey: "firstCourse",
    betSelection: "3-1-2",
    decisionCutoff: cutoff,
    features: {},
  }), { status: "MATCHED", featureKey: "firstCourse", bucket: "3" });
  assert.deepEqual(resolveN2EdgeFeatureBucket({
    featureKey: "secondCourse",
    betSelection: "3-1-2",
    decisionCutoff: cutoff,
    features: {},
  }), { status: "MATCHED", featureKey: "secondCourse", bucket: "1" });
});

test("numeric buckets reuse frozen discovery percentage cuts", () => {
  const features = {
    firstMotorTop2Rate: {
      value: 40,
      pitClass: "historical_safe" as const,
      availableAt: "2022-01-01T03:00:00.000Z",
    },
  };
  assert.equal(resolveN2EdgeFeatureBucket({
    featureKey: "firstMotorTop2Rate",
    betSelection: "1-2-3",
    decisionCutoff: cutoff,
    features,
  }).bucket, "[40,50)");
});

test("timed feature remains adapter-gated in holdout confirmation", () => {
  const blocked = resolveN2EdgeFeatureBucket({
    featureKey: "firstStartTiming",
    betSelection: "1-2-3",
    decisionCutoff: cutoff,
    features: {
      firstStartTiming: {
        value: 0.1,
        pitClass: "historical_safe",
        availableAt: "2022-01-01T03:00:00.000Z",
        adapterVerified: false,
        adapterId: "unverified",
      },
    },
  });
  assert.equal(blocked.status, "ADAPTER_BLOCKED");

  const allowed = resolveN2EdgeFeatureBucket({
    featureKey: "firstStartTiming",
    betSelection: "1-2-3",
    decisionCutoff: cutoff,
    features: {
      firstStartTiming: {
        value: 0.1,
        pitClass: "historical_safe",
        availableAt: "2022-01-01T03:00:00.000Z",
        adapterVerified: true,
        adapterId: "reviewed-v1",
      },
    },
  });
  assert.equal(allowed.status, "MATCHED");
  assert.equal(allowed.bucket, "[0.08,0.12)");
});

test("future availability and unknown features fail closed", () => {
  assert.equal(resolveN2EdgeFeatureBucket({
    featureKey: "firstClassName",
    betSelection: "1-2-3",
    decisionCutoff: cutoff,
    features: {
      firstClassName: {
        value: "A1",
        pitClass: "historical_safe",
        availableAt: "2022-01-01T04:00:00.000Z",
      },
    },
  }).status, "PIT_BLOCKED");

  assert.equal(resolveN2EdgeFeatureBucket({
    featureKey: "inventedFeature",
    betSelection: "1-2-3",
    decisionCutoff: cutoff,
    features: {},
  }).status, "UNKNOWN_FEATURE");
});

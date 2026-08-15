import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_BASELINE_ROW_VERSION,
  validateN2BaselineRow,
  type N2BaselinePredictionRow,
} from "./n2BaselineEvaluation";

function historicalRow(
  canonicalRaceKey: string,
  trainingToRaceKeyExclusive: string,
): N2BaselinePredictionRow {
  return {
    rowVersion: N2_BASELINE_ROW_VERSION,
    baselineId: "historical-race-order-v1",
    baselineKind: "historical_only",
    canonicalRaceKey,
    betType: "win",
    betSelection: "1",
    split: "test",
    decisionCutoff: "2024-06-01T01:00:00.000Z",
    predictionAvailableAt: "2024-06-01T00:50:00.000Z",
    probability: 0.2,
    hit: 0,
    provenance: {
      kind: "historical_only",
      modelVersion: "historical-prior-v1",
      featureContractVersion: "n2-feature-pit-contract-v2",
      trainingToRaceKeyExclusive,
      trainingSnapshotDigest: "a".repeat(64),
    },
  };
}

test("historical PIT boundary rejects R10 when evaluating earlier R9", () => {
  const validation = validateN2BaselineRow(
    historicalRow("2024-06-01:01:R9", "2024-06-01:01:R10"),
  );

  assert.equal(validation.valid, false);
  assert.match(
    validation.errors.join("\n"),
    /historical training boundary reaches evaluation row/,
  );
});

test("historical PIT boundary accepts R9 when evaluating later R10", () => {
  const validation = validateN2BaselineRow(
    historicalRow("2024-06-01:01:R10", "2024-06-01:01:R9"),
  );

  assert.equal(validation.valid, true, validation.errors.join("\n"));
});

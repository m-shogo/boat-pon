import assert from "node:assert/strict";
import test from "node:test";
import {
  N2_BASELINE_ROW_VERSION,
  splitForN2RaceKey,
  validateN2BaselineRow,
  type N2BaselinePredictionRow,
} from "./n2BaselineEvaluation";

function historicalRow(trainingToRaceKeyExclusive: string): N2BaselinePredictionRow {
  return {
    rowVersion: N2_BASELINE_ROW_VERSION,
    baselineId: "historical-v1",
    baselineKind: "historical_only",
    canonicalRaceKey: "2024-06-01:01:R1",
    betType: "win",
    betSelection: "1",
    split: "test",
    decisionCutoff: "2024-06-01T01:00:00.000Z",
    predictionAvailableAt: "2024-06-01T00:50:00.000Z",
    probability: 0.2,
    hit: 1,
    provenance: {
      kind: "historical_only",
      modelVersion: "historical-prior-v1",
      featureContractVersion: "n2-feature-pit-contract-v2",
      trainingToRaceKeyExclusive,
      trainingSnapshotDigest: "a".repeat(64),
    },
  };
}

test("baseline split rejects impossible calendar race keys", () => {
  for (const key of [
    "2026-02-29:01:R1",
    "2026-02-30:01:R1",
    "2026-04-31:01:R1",
    "2026-13-01:01:R1",
  ]) {
    assert.equal(splitForN2RaceKey(key), null, `${key} must be rejected`);
  }
  assert.equal(splitForN2RaceKey("2028-02-29:24:R12"), "forward_shadow");
});

test("historical training boundary requires a canonical real race key", () => {
  for (const key of [
    "2024-02-30:01:R1",
    "2024-06-01:25:R1",
    "2024-06-01:01:R13",
  ]) {
    const validation = validateN2BaselineRow(historicalRow(key));
    assert.equal(validation.valid, false, `${key} must be rejected`);
    assert.match(validation.errors.join("\n"), /invalid trainingToRaceKeyExclusive/);
  }

  assert.equal(validateN2BaselineRow(historicalRow("2024-02-29:01:R1")).valid, true);
});

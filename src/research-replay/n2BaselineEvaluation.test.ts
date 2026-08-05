import assert from "node:assert/strict";
import test from "node:test";
import {
  N2_BASELINE_ROW_VERSION,
  buildMarketOnlyBaselineRow,
  calculateN2BaselineMetrics,
  compareN2BaselinesOnCommonCohort,
  evaluateN2Baseline,
  n2BaselineRowIdentity,
  splitForN2RaceKey,
  validateN2BaselineRow,
  validateN2BaselineRows,
  type N2BaselinePredictionRow,
} from "./n2BaselineEvaluation";

function marketRow(overrides: Partial<N2BaselinePredictionRow> = {}): N2BaselinePredictionRow {
  return {
    rowVersion: N2_BASELINE_ROW_VERSION,
    baselineId: "market-v1",
    baselineKind: "market_only",
    canonicalRaceKey: "2024-06-01:01:R1",
    betType: "win",
    betSelection: "1",
    split: "test",
    decisionCutoff: "2024-06-01T01:00:00.000Z",
    predictionAvailableAt: "2024-06-01T00:55:00.000Z",
    probability: 0.25,
    hit: 1,
    provenance: {
      kind: "market_only",
      odds: 4,
      probabilityMethod: "reciprocal_odds_raw",
      capturedAt: "2024-06-01T00:55:00.000Z",
      availableAt: "2024-06-01T00:55:00.000Z",
      observationId: "obs-market-1",
      rawDocumentId: "raw-market-1",
    },
    ...overrides,
  };
}

function historicalRow(overrides: Partial<N2BaselinePredictionRow> = {}): N2BaselinePredictionRow {
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
      trainingToRaceKeyExclusive: "2024-01-01:01:R1",
      trainingSnapshotDigest: "a".repeat(64),
    },
    ...overrides,
  };
}

function legacyRow(overrides: Partial<N2BaselinePredictionRow> = {}): N2BaselinePredictionRow {
  return {
    rowVersion: N2_BASELINE_ROW_VERSION,
    baselineId: "legacy-v4",
    baselineKind: "legacy",
    canonicalRaceKey: "2024-06-01:01:R1",
    betType: "win",
    betSelection: "1",
    split: "test",
    decisionCutoff: "2024-06-01T01:00:00.000Z",
    predictionAvailableAt: "2024-06-01T00:45:00.000Z",
    probability: 0.3,
    hit: 1,
    provenance: {
      kind: "legacy",
      modelVersion: "v4-conservative",
      decisionSnapshotId: "decision-history:1",
    },
    ...overrides,
  };
}

test("time split boundaries are deterministic and half-open", () => {
  assert.equal(splitForN2RaceKey("2021-12-31:24:R12"), "train");
  assert.equal(splitForN2RaceKey("2022-01-01:01:R1"), "validation");
  assert.equal(splitForN2RaceKey("2023-12-31:24:R12"), "validation");
  assert.equal(splitForN2RaceKey("2024-01-01:01:R1"), "test");
  assert.equal(splitForN2RaceKey("2025-12-31:24:R12"), "test");
  assert.equal(splitForN2RaceKey("2026-01-01:01:R1"), "forward_shadow");
  assert.equal(splitForN2RaceKey("invalid"), null);
});

test("safe market-only row is built from reciprocal observed odds", () => {
  const result = buildMarketOnlyBaselineRow({
    baselineId: "market-v1",
    canonicalRaceKey: "2024-06-01:01:R1",
    betType: "win",
    betSelection: "1",
    decisionCutoff: "2024-06-01T01:00:00.000Z",
    hit: 1,
    odds: 4,
    capturedAt: "2024-06-01T00:55:00.000Z",
    availableAt: "2024-06-01T00:55:00.000Z",
    observationId: "obs-market-1",
    rawDocumentId: "raw-market-1",
  });
  assert.equal(result.status, "built");
  if (result.status === "built") {
    assert.equal(result.row.probability, 0.25);
    assert.equal(result.row.split, "test");
    assert.equal(validateN2BaselineRow(result.row).valid, true);
  }
});

test("market row fails closed for future capture or inconsistent implied probability", () => {
  const future = marketRow({
    predictionAvailableAt: "2024-06-01T01:00:00.001Z",
    provenance: {
      kind: "market_only",
      odds: 4,
      probabilityMethod: "reciprocal_odds_raw",
      capturedAt: "2024-06-01T01:00:00.001Z",
      availableAt: "2024-06-01T01:00:00.001Z",
      observationId: "obs-market-1",
      rawDocumentId: "raw-market-1",
    },
  });
  const futureValidation = validateN2BaselineRow(future);
  assert.equal(futureValidation.valid, false);
  assert.match(futureValidation.errors.join("\n"), /prediction available after decision cutoff/);
  assert.match(futureValidation.errors.join("\n"), /excluded_odds_capture_after_cutoff/);

  const inconsistent = validateN2BaselineRow(marketRow({ probability: 0.4 }));
  assert.equal(inconsistent.valid, false);
  assert.match(inconsistent.errors.join("\n"), /market probability does not match reciprocal odds/);
});

test("historical-only baseline requires a pre-row training boundary and immutable snapshot digest", () => {
  assert.equal(validateN2BaselineRow(historicalRow()).valid, true);
  const leaking = historicalRow({
    provenance: {
      kind: "historical_only",
      modelVersion: "historical-prior-v1",
      featureContractVersion: "n2-feature-pit-contract-v2",
      trainingToRaceKeyExclusive: "2025-01-01:01:R1",
      trainingSnapshotDigest: "bad",
    },
  });
  const validation = validateN2BaselineRow(leaking);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /historical training boundary reaches evaluation row/);
  assert.match(validation.errors.join("\n"), /invalid trainingSnapshotDigest/);
});

test("row validation rejects split, selection and provenance laundering", () => {
  const invalid = marketRow({
    split: "validation",
    betSelection: "7",
    baselineKind: "historical_only",
  });
  const validation = validateN2BaselineRow(invalid);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /split mismatch/);
  assert.match(validation.errors.join("\n"), /noncanonical betSelection/);
  assert.match(validation.errors.join("\n"), /baselineKind\/provenance mismatch/);
});

test("baseline collection rejects duplicate identities and mixed baseline IDs", () => {
  const duplicate = marketRow();
  const validation = validateN2BaselineRows([
    duplicate,
    { ...duplicate, baselineId: "market-v2" },
  ]);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /mixed baselineId/);
  assert.match(validation.errors.join("\n"), /duplicate identity/);
});

test("metrics calculate logloss, Brier and calibration deterministically", () => {
  const rows = [
    marketRow({ betSelection: "1", probability: 0.8, hit: 1, provenance: { ...marketRow().provenance as any, odds: 1.25 } }),
    marketRow({ betSelection: "2", probability: 0.2, hit: 0, provenance: { ...marketRow().provenance as any, odds: 5 } }),
  ];
  const metrics = calculateN2BaselineMetrics(rows);
  assert.equal(metrics.rowCount, 2);
  assert.equal(metrics.positiveCount, 1);
  assert.equal(metrics.positiveRate, 0.5);
  assert.equal(metrics.meanProbability, 0.5);
  assert.ok(Math.abs(metrics.logLoss! - -Math.log(0.8)) < 1e-12);
  assert.ok(Math.abs(metrics.brierScore! - 0.04) < 1e-12);
  assert.ok(metrics.expectedCalibrationError! >= 0);
  assert.equal(metrics.calibrationBins.reduce((sum, bin) => sum + bin.count, 0), 2);
});

test("evaluation digest is stable across input ordering", () => {
  const first = marketRow({ betSelection: "1", probability: 0.5, hit: 1, provenance: { ...marketRow().provenance as any, odds: 2 } });
  const second = marketRow({ betSelection: "2", probability: 0.25, hit: 0, provenance: { ...marketRow().provenance as any, odds: 4 } });
  const a = evaluateN2Baseline([first, second]);
  const b = evaluateN2Baseline([second, first]);
  assert.equal(a.status, "PASS");
  assert.equal(a.rowSetDigest, b.rowSetDigest);
  assert.equal(a.outputDigest, b.outputDigest);
  assert.equal(a.splitCounts.test, 2);
  assert.equal(a.splitCounts.train, 0);
});

test("common-cohort comparison uses exact identities and reports outside rows", () => {
  const market = [
    marketRow({ betSelection: "1", probability: 0.5, hit: 1, provenance: { ...marketRow().provenance as any, odds: 2 } }),
    marketRow({ betSelection: "2", probability: 0.25, hit: 0, provenance: { ...marketRow().provenance as any, odds: 4 } }),
  ];
  const historical = [
    historicalRow({ betSelection: "1", probability: 0.4, hit: 1 }),
    historicalRow({ betSelection: "2", probability: 0.2, hit: 0 }),
    historicalRow({ betSelection: "3", probability: 0.1, hit: 0 }),
  ];
  const comparison = compareN2BaselinesOnCommonCohort({
    baselines: { "market-v1": market, "historical-v1": historical },
    minimumCommonRows: 2,
  });
  assert.equal(comparison.status, "COMPARABLE");
  assert.equal(comparison.commonRowCount, 2);
  assert.deepEqual(comparison.excludedOutsideCommonCohort, { "historical-v1": 1, "market-v1": 0 });
  assert.equal(comparison.reports["market-v1"].rowCount, 2);
  assert.equal(comparison.reports["historical-v1"].rowCount, 2);
});

test("common cohort refuses insufficient overlap without ranking", () => {
  const comparison = compareN2BaselinesOnCommonCohort({
    baselines: {
      "market-v1": [marketRow()],
      "historical-v1": [historicalRow()],
    },
    minimumCommonRows: 100,
  });
  assert.equal(comparison.status, "INSUFFICIENT_COMMON_COHORT");
  assert.equal(comparison.commonRowCount, 1);
});

test("label or cutoff mismatch is a comparison conflict", () => {
  const comparison = compareN2BaselinesOnCommonCohort({
    baselines: {
      "market-v1": [marketRow()],
      "historical-v1": [historicalRow({
        hit: 0,
        decisionCutoff: "2024-06-01T00:59:00.000Z",
      })],
    },
    minimumCommonRows: 1,
  });
  assert.equal(comparison.status, "CONFLICT");
  assert.match(comparison.conflicts.join("\n"), /label mismatch/);
  assert.match(comparison.conflicts.join("\n"), /decisionCutoff mismatch/);
});

test("map key must equal row baseline ID", () => {
  const comparison = compareN2BaselinesOnCommonCohort({
    baselines: {
      wrong: [marketRow()],
      "legacy-v4": [legacyRow()],
    },
    minimumCommonRows: 1,
  });
  assert.equal(comparison.status, "CONFLICT");
  assert.match(comparison.conflicts.join("\n"), /map key\/baselineId mismatch/);
});

test("identity includes split to prevent cross-period mixing", () => {
  const testRow = marketRow();
  const forwardRow = marketRow({
    canonicalRaceKey: "2026-06-01:01:R1",
    split: "forward_shadow",
    decisionCutoff: "2026-06-01T01:00:00.000Z",
    predictionAvailableAt: "2026-06-01T00:55:00.000Z",
    provenance: {
      kind: "market_only",
      odds: 4,
      probabilityMethod: "reciprocal_odds_raw",
      capturedAt: "2026-06-01T00:55:00.000Z",
      availableAt: "2026-06-01T00:55:00.000Z",
      observationId: "obs-market-forward",
      rawDocumentId: "raw-market-forward",
    },
  });
  assert.notEqual(n2BaselineRowIdentity(testRow), n2BaselineRowIdentity(forwardRow));
});

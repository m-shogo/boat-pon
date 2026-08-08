import assert from "node:assert/strict";
import test from "node:test";

import type { N2EdgeConfirmationRace } from "./n2EdgeHistoricalConfirmation";
import { buildN2EdgeHoldoutDistributionEvidence } from "./n2EdgeHoldoutDistributionEvidence";

function race(
  canonicalRaceKey: string,
  split: "validation" | "test",
  residuals: Record<string, number>,
): N2EdgeConfirmationRace {
  return { canonicalRaceKey, split, residualByHypothesisId: residuals };
}

test("evidence summarizes venue/year concentration without persisting identities", () => {
  const report = buildN2EdgeHoldoutDistributionEvidence({
    lockedHypothesisIds: ["H-A", "H-B"],
    races: [
      race("2022-01-01:01:R1", "validation", { "H-A": 0.01, "H-B": -0.01 }),
      race("2022-01-02:01:R1", "validation", { "H-A": 0.02 }),
      race("2023-01-01:02:R1", "validation", { "H-A": 0.03, "H-B": -0.02 }),
      race("2024-01-01:03:R1", "test", { "H-A": 0.01, "H-B": -0.01 }),
      race("2025-01-01:04:R1", "test", { "H-A": 0.02, "H-B": -0.02 }),
      race("2025-01-02:04:R1", "test", { "H-B": -0.03 }),
    ],
  });
  assert.equal(report.status, "PASS");
  assert.equal(report.lockedHypothesisCount, 2);
  const a = report.hypotheses.find((item) => item.hypothesisId === "H-A")!;
  assert.equal(a.validation.uniqueRaceCount, 3);
  assert.equal(a.validation.distinctVenueCount, 2);
  assert.equal(a.validation.maxVenueRaceCount, 2);
  assert.equal(a.validation.maxVenueShare, 2 / 3);
  assert.equal(a.validation.distinctYearCount, 2);
  assert.equal(a.validation.maxYearRaceCount, 2);
  assert.equal(a.validation.maxYearShare, 2 / 3);
  assert.equal(a.test.uniqueRaceCount, 2);
  assert.equal(a.test.distinctVenueCount, 2);
  assert.equal(a.test.maxVenueShare, 1 / 2);
  assert.equal(a.test.distinctYearCount, 2);
  assert.equal(a.test.maxYearShare, 1 / 2);

  const b = report.hypotheses.find((item) => item.hypothesisId === "H-B")!;
  assert.equal(b.validation.uniqueRaceCount, 2);
  assert.equal(b.validation.distinctVenueCount, 2);
  assert.equal(b.test.uniqueRaceCount, 3);
  assert.equal(b.test.distinctVenueCount, 2);
  assert.equal(b.test.maxVenueRaceCount, 2);
  assert.equal(b.test.maxVenueShare, 2 / 3);

  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /202[2-5]-\d{2}-\d{2}:\d{2}:R\d+/u);
  assert.doesNotMatch(serialized, /"(?:venueCode|year|canonicalRaceKey|residualByHypothesisId)"\s*:/u);
  assert.equal(report.privacy.raceKeysPersisted, false);
  assert.equal(report.authority.confirmationVerdictChanged, false);
  assert.equal(report.authority.rejectionRescueAuthorized, false);
  assert.equal(report.authority.automaticPromotionAuthorized, false);
});

test("zero support stays explicit as null shares rather than fake zero evidence", () => {
  const report = buildN2EdgeHoldoutDistributionEvidence({
    lockedHypothesisIds: ["H-A"],
    races: [
      race("2022-01-01:01:R1", "validation", {}),
      race("2024-01-01:01:R1", "test", {}),
    ],
  });
  assert.equal(report.status, "PASS");
  const evidence = report.hypotheses[0];
  assert.equal(evidence.validation.uniqueRaceCount, 0);
  assert.equal(evidence.validation.maxVenueShare, null);
  assert.equal(evidence.validation.maxYearShare, null);
  assert.equal(evidence.test.uniqueRaceCount, 0);
  assert.equal(evidence.test.maxVenueShare, null);
});

test("unknown hypotheses, duplicates, split spoofing and invalid residuals fail closed", () => {
  const unknown = buildN2EdgeHoldoutDistributionEvidence({
    lockedHypothesisIds: ["H-A"],
    races: [race("2022-01-01:01:R1", "validation", { "H-X": 0.01 })],
  });
  assert.equal(unknown.status, "BLOCKED");
  assert.ok(unknown.blockers.includes("UNKNOWN_HYPOTHESIS_ID:H-X"));

  const duplicate = buildN2EdgeHoldoutDistributionEvidence({
    lockedHypothesisIds: ["H-A", "H-A"],
    races: [],
  });
  assert.equal(duplicate.status, "BLOCKED");
  assert.ok(duplicate.blockers.includes("DUPLICATE_LOCKED_HYPOTHESIS_ID"));

  const spoof = buildN2EdgeHoldoutDistributionEvidence({
    lockedHypothesisIds: ["H-A"],
    races: [race("2024-01-01:01:R1", "validation", { "H-A": 0.01 })],
  });
  assert.equal(spoof.status, "BLOCKED");
  assert.ok(spoof.blockers.some((blocker) => blocker.startsWith("SPLIT_MISMATCH:")));

  const invalid = buildN2EdgeHoldoutDistributionEvidence({
    lockedHypothesisIds: ["H-A"],
    races: [race("2022-01-01:01:R1", "validation", { "H-A": Number.NaN })],
  });
  assert.equal(invalid.status, "BLOCKED");
  assert.ok(invalid.blockers.includes("H-A:INVALID_RACE_RESIDUAL"));
});

test("input order cannot change aggregate evidence or digest", () => {
  const races = [
    race("2022-01-01:01:R1", "validation", { "H-A": 0.01 }),
    race("2023-01-01:02:R1", "validation", { "H-A": 0.02 }),
    race("2024-01-01:03:R1", "test", { "H-A": 0.01 }),
    race("2025-01-01:04:R1", "test", { "H-A": 0.02 }),
  ];
  const first = buildN2EdgeHoldoutDistributionEvidence({ lockedHypothesisIds: ["H-A"], races });
  const second = buildN2EdgeHoldoutDistributionEvidence({ lockedHypothesisIds: ["H-A"], races: [...races].reverse() });
  assert.equal(first.status, "PASS");
  assert.equal(first.outputDigest, second.outputDigest);
  assert.deepEqual(first.hypotheses, second.hypotheses);
});

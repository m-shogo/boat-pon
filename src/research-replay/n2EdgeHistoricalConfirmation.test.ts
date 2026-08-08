import assert from "node:assert/strict";
import test from "node:test";

import type { N2EdgeHypothesis } from "./n2EdgeHypothesisScan";
import {
  confirmN2EdgeHypothesesHistorically,
  type N2EdgeConfirmationRace,
} from "./n2EdgeHistoricalConfirmation";

function hypothesis(id: string, direction: N2EdgeHypothesis["direction"] = "underpredicted"): N2EdgeHypothesis {
  return {
    hypothesisId: id,
    featureKey: id === "H1" ? "firstCourse" : "firstClassName",
    family: id === "H1" ? "course" : "player",
    selectionRole: "first",
    bucket: id === "H1" ? "1" : "A1",
    direction,
    uniqueRaceCount: 300,
    meanResidual: direction === "underpredicted" ? 0.05 : -0.05,
    standardError: 0.005,
    zScore: direction === "underpredicted" ? 10 : -10,
    rawPValue: 1e-10,
    holmAdjustedPValue: 2e-10,
    discoverySplit: "train",
    confirmationSplits: ["validation", "test"],
    forwardShadowReserved: true,
  };
}

function date(base: string, offset: number): string {
  const value = new Date(`${base}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function races(count: number): N2EdgeConfirmationRace[] {
  const rows: N2EdgeConfirmationRace[] = [];
  for (let index = 0; index < count; index += 1) {
    const validationDate = date("2022-01-01", index);
    const testDate = date("2024-01-01", index);
    rows.push({
      canonicalRaceKey: `${validationDate}:05:R1`,
      split: "validation",
      residualByHypothesisId: {
        H1: 0.05 + (index % 2 === 0 ? 0.01 : -0.01),
        H2: 0.05 + (index % 3 === 0 ? 0.01 : -0.005),
      },
    });
    rows.push({
      canonicalRaceKey: `${testDate}:05:R1`,
      split: "test",
      residualByHypothesisId: {
        H1: 0.045 + (index % 2 === 0 ? 0.01 : -0.01),
        H2: -0.04 + (index % 3 === 0 ? 0.008 : -0.004),
      },
    });
  }
  return rows;
}

test("locked hypothesis confirms only when validation and test both reproduce direction and significance", () => {
  const report = confirmN2EdgeHypothesesHistorically({
    lockedHypotheses: [hypothesis("H1"), hypothesis("H2")],
    races: races(220),
  });
  assert.equal(report.status, "PASS");
  assert.equal(report.validationRaceCount, 220);
  assert.equal(report.testRaceCount, 220);
  assert.equal(report.confirmedCount, 1);
  assert.equal(report.rejectedCount, 1);
  assert.equal(report.insufficientCount, 0);
  const h1 = report.results.find((result) => result.hypothesisId === "H1")!;
  const h2 = report.results.find((result) => result.hypothesisId === "H2")!;
  assert.equal(h1.verdict, "HISTORICAL_CONFIRMED");
  assert.equal(h1.validation.statisticallyConfirmed, true);
  assert.equal(h1.test.statisticallyConfirmed, true);
  assert.ok(h1.validation.holmAdjustedPValue <= 0.05);
  assert.ok(h1.test.holmAdjustedPValue <= 0.05);
  assert.equal(h2.verdict, "HISTORICAL_REJECTED");
  assert.equal(h2.validation.directionMatchesDiscovery, true);
  assert.equal(h2.test.directionMatchesDiscovery, false);
  assert.equal(h2.test.statisticallyConfirmed, false);
  assert.equal(report.confirmationMethod.rediscoveryAllowed, false);
  assert.equal(report.confirmationMethod.forwardShadowUsed, false);
  assert.equal(report.authority.automaticPromotionAuthorized, false);
});

test("199 races per holdout split is insufficient even with a huge apparent effect", () => {
  const report = confirmN2EdgeHypothesesHistorically({
    lockedHypotheses: [hypothesis("H1")],
    races: races(199).map((race) => ({
      ...race,
      residualByHypothesisId: { H1: 0.2 },
    })),
  });
  assert.equal(report.status, "PASS");
  assert.equal(report.confirmedCount, 0);
  assert.equal(report.insufficientCount, 1);
  assert.equal(report.results[0].verdict, "INSUFFICIENT_HOLDOUT");
  assert.equal(report.results[0].validation.supportSufficient, false);
  assert.equal(report.results[0].test.supportSufficient, false);
});

test("unknown hypothesis residual is rejected instead of creating a new holdout hypothesis", () => {
  const report = confirmN2EdgeHypothesesHistorically({
    lockedHypotheses: [hypothesis("H1")],
    races: [{
      canonicalRaceKey: "2022-01-01:05:R1",
      split: "validation",
      residualByHypothesisId: { H_NEW: 0.9 },
    }],
  });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes("UNKNOWN_HYPOTHESIS_ID:H_NEW"));
  assert.equal(report.results.length, 0);
});

test("canonical split is recomputed so forward/test rows cannot be mislabeled as validation", () => {
  const forwardSpoof = confirmN2EdgeHypothesesHistorically({
    lockedHypotheses: [hypothesis("H1")],
    races: [{
      canonicalRaceKey: "2026-08-08:05:R1",
      split: "validation",
      residualByHypothesisId: { H1: 0.1 },
    }],
  });
  assert.equal(forwardSpoof.status, "BLOCKED");
  assert.ok(forwardSpoof.blockers.includes("SPLIT_MISMATCH:2026-08-08:05:R1:validation/forward_shadow"));
  assert.equal(forwardSpoof.authority.forwardLabelsUsedForConfirmation, false);

  const testSpoof = confirmN2EdgeHypothesesHistorically({
    lockedHypotheses: [hypothesis("H1")],
    races: [{
      canonicalRaceKey: "2024-01-01:05:R1",
      split: "validation",
      residualByHypothesisId: { H1: 0.1 },
    }],
  });
  assert.equal(testSpoof.status, "BLOCKED");
  assert.ok(testSpoof.blockers.includes("SPLIT_MISMATCH:2024-01-01:05:R1:validation/test"));
});

test("duplicate race-level residual row fails closed to preserve race-level independence", () => {
  const row: N2EdgeConfirmationRace = {
    canonicalRaceKey: "2022-01-01:05:R1",
    split: "validation",
    residualByHypothesisId: { H1: 0.1 },
  };
  const report = confirmN2EdgeHypothesesHistorically({
    lockedHypotheses: [hypothesis("H1")],
    races: [row, { ...row }],
  });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes("DUPLICATE_RACE:2022-01-01:05:R1"));
});

test("Holm correction includes every locked hypothesis, including unsupported ones", () => {
  const base = races(220).map((race) => ({
    ...race,
    residualByHypothesisId: { H1: race.residualByHypothesisId.H1 },
  }));
  const report = confirmN2EdgeHypothesesHistorically({
    lockedHypotheses: [hypothesis("H1"), hypothesis("H2")],
    races: base,
  });
  assert.equal(report.status, "PASS");
  const h2 = report.results.find((result) => result.hypothesisId === "H2")!;
  assert.equal(h2.verdict, "INSUFFICIENT_HOLDOUT");
  assert.equal(h2.validation.rawPValue, 1);
  assert.equal(h2.test.rawPValue, 1);
  assert.equal(h2.validation.holmAdjustedPValue, 1);
  assert.equal(h2.test.holmAdjustedPValue, 1);
});

test("confirmation result is deterministic under race and hypothesis input reordering", () => {
  const inputRaces = races(220);
  const first = confirmN2EdgeHypothesesHistorically({
    lockedHypotheses: [hypothesis("H1"), hypothesis("H2")],
    races: inputRaces,
  });
  const second = confirmN2EdgeHypothesesHistorically({
    lockedHypotheses: [hypothesis("H2"), hypothesis("H1")],
    races: [...inputRaces].reverse(),
  });
  assert.equal(first.status, "PASS");
  assert.equal(first.outputDigest, second.outputDigest);
  assert.deepEqual(first.results, second.results);
});

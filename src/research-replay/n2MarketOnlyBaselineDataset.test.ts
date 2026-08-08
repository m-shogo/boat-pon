import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_MARKET_ONLY_BASELINE_COHORT_RACE_COUNT,
  buildN2MarketOnlyBaselineDataset,
  compareN2RaceKeysByRaceTime,
  type N2MarketOnlyBaselineRaceSource,
} from "./n2MarketOnlyBaselineDataset";

function selections(): N2MarketOnlyBaselineRaceSource["selections"] {
  const values: N2MarketOnlyBaselineRaceSource["selections"] = [];
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      if (second === first) continue;
      for (let third = 1; third <= 6; third += 1) {
        if (third === first || third === second) continue;
        values.push({
          selection: `${first}-${second}-${third}`,
          odds: first * 100 + second * 10 + third,
        });
      }
    }
  }
  return values;
}

function source(raceKey: string): N2MarketOnlyBaselineRaceSource {
  return {
    canonicalRaceKey: raceKey,
    decisionCutoff: "2026-08-08T03:30:00.000Z",
    capturedAt: "2026-08-08T03:25:30.000Z",
    availableAt: "2026-08-08T03:25:00.000Z",
    observationId: `obs-${raceKey}`,
    rawDocumentId: `raw-${raceKey}`,
    winningSelection: "1-2-3",
    selections: selections(),
  };
}

function twentySources(): N2MarketOnlyBaselineRaceSource[] {
  return [
    ...Array.from({ length: 12 }, (_, index) => source(`2026-08-07:05:R${index + 1}`)),
    ...Array.from({ length: 8 }, (_, index) => source(`2026-08-08:05:R${index + 1}`)),
  ];
}

test("race-time ordering is numeric within a venue", () => {
  const keys = [
    "2026-08-07:05:R10",
    "2026-08-07:05:R2",
    "2026-08-07:04:R12",
    "2026-08-08:01:R1",
  ].sort(compareN2RaceKeysByRaceTime);
  assert.deepEqual(keys, [
    "2026-08-07:04:R12",
    "2026-08-07:05:R2",
    "2026-08-07:05:R10",
    "2026-08-08:01:R1",
  ]);
});

test("market-only baseline fixes the initial cohort at 20 settled T-5 races", () => {
  const extraEarlierInArrayButLaterInTime = source("2026-08-09:05:R1");
  const dataset = buildN2MarketOnlyBaselineDataset({
    sources: [extraEarlierInArrayButLaterInTime, ...twentySources()],
  });
  assert.equal(dataset.status, "PASS");
  assert.deepEqual(dataset.blockers, []);
  assert.equal(dataset.sourceRaceCount, 21);
  assert.equal(dataset.cohortRaceCount, N2_MARKET_ONLY_BASELINE_COHORT_RACE_COUNT);
  assert.equal(dataset.rowCount, 20 * 120);
  assert.equal(dataset.positiveCount, 20);
  assert.equal(dataset.evaluation.status, "PASS");
  assert.equal(dataset.evaluation.splitCounts.forward_shadow, 20 * 120);
  assert.equal(dataset.rows.some((row) => row.canonicalRaceKey === "2026-08-09:05:R1"), false);
  assert.equal(dataset.rows[0].canonicalRaceKey, "2026-08-07:05:R1");
  assert.equal(dataset.rows[120].canonicalRaceKey, "2026-08-07:05:R2");
  assert.match(dataset.cohortDigest, /^[0-9a-f]{64}$/u);
  assert.match(dataset.outputDigest, /^[0-9a-f]{64}$/u);
});

test("dataset does not build before the activation cohort is complete", () => {
  const dataset = buildN2MarketOnlyBaselineDataset({
    sources: twentySources().slice(0, 19),
  });
  assert.equal(dataset.status, "BLOCKED");
  assert.deepEqual(dataset.blockers, ["INSUFFICIENT_SETTLED_T5_RACES:19/20"]);
  assert.equal(dataset.rowCount, 0);
});

test("duplicate race sources fail closed instead of silently choosing one", () => {
  const first = source("2026-08-07:05:R1");
  const dataset = buildN2MarketOnlyBaselineDataset({
    sources: [first, { ...first, rawDocumentId: "raw-other" }, ...twentySources().slice(1)],
  });
  assert.equal(dataset.status, "BLOCKED");
  assert.deepEqual(dataset.blockers, ["DUPLICATE_RACE_SOURCE:1"]);
});

test("post-cutoff market evidence blocks the entire fixed cohort", () => {
  const sources = twentySources();
  sources[4] = {
    ...sources[4],
    availableAt: "2026-08-08T03:31:00.000Z",
  };
  const dataset = buildN2MarketOnlyBaselineDataset({ sources });
  assert.equal(dataset.status, "BLOCKED");
  assert.ok(dataset.blockers.some((blocker) => blocker.endsWith(":AVAILABLE_AFTER_DECISION_CUTOFF")));
  assert.equal(dataset.rowCount, 0);
});

test("every race must expose exactly the canonical 120-selection market", () => {
  const sources = twentySources();
  sources[0] = {
    ...sources[0],
    selections: sources[0].selections.slice(0, 119),
  };
  const dataset = buildN2MarketOnlyBaselineDataset({ sources });
  assert.equal(dataset.status, "BLOCKED");
  assert.ok(dataset.blockers.some((blocker) => blocker.endsWith(":SELECTION_COUNT_NOT_120")));
});

import assert from "node:assert/strict";
import test from "node:test";

import type { N2TrifectaMarketRaceFeatureSequence } from "./n2TrifectaMarketFeatureEngineering.js";
import type { N2TrifectaPrivateMarketFeatureLoadReport } from "./n2TrifectaPrivateMarketFeatureLoader.js";
import { buildN2TrifectaPrivateMarketFeatureArtifact } from "./n2TrifectaPrivateMarketFeatureArtifact.js";

function report(): N2TrifectaPrivateMarketFeatureLoadReport {
  return {
    loaderVersion: "n2-trifecta-private-market-feature-loader-v1",
    status: "PASS",
    blockers: [],
    date: "2026-08-07",
    venueCode: "10",
    raceNo: 4,
    raceIdentity: "20260807-10-04",
    acceptedMarkerCount: 4,
    loadedSnapshotCount: 4,
    sequence: { status: "PASS" } as unknown as N2TrifectaMarketRaceFeatureSequence,
    networkRequestCount: 0,
    databaseReadCount: 0,
    databaseWriteCount: 0,
    rawValuesReadPrivately: true,
    rawValuesPublished: false,
    privateResearchOnly: true,
    publicPublishAuthorized: false,
    outputDigest: "a".repeat(64),
  };
}

test("rejects feature artifacts whose path fields do not match race identity", () => {
  for (const mutate of [
    (value: N2TrifectaPrivateMarketFeatureLoadReport) => { value.date = "2026-08-08"; },
    (value: N2TrifectaPrivateMarketFeatureLoadReport) => { value.venueCode = "11"; },
    (value: N2TrifectaPrivateMarketFeatureLoadReport) => { value.raceNo = 5; },
  ]) {
    const value = report();
    mutate(value);
    assert.throws(
      () => buildN2TrifectaPrivateMarketFeatureArtifact({
        report: value,
        generatedAt: "2026-08-07T02:00:00.000Z",
      }),
      /PRIVATE_FEATURE_ARTIFACT_RACE_LINEAGE_MISMATCH/u,
    );
  }
});

test("rejects impossible feature artifact race dates before persistence", () => {
  const value = report();
  value.date = "2026-02-30";
  value.raceIdentity = "20260230-10-04";
  assert.throws(
    () => buildN2TrifectaPrivateMarketFeatureArtifact({
      report: value,
      generatedAt: "2026-08-07T02:00:00.000Z",
    }),
    /PRIVATE_FEATURE_ARTIFACT_RACE_FIELDS_INVALID/u,
  );
});

test("keeps valid leap-day feature artifact identity", () => {
  const value = report();
  value.date = "2028-02-29";
  value.raceIdentity = "20280229-10-04";
  const artifact = buildN2TrifectaPrivateMarketFeatureArtifact({
    report: value,
    generatedAt: "2028-02-29T02:00:00.000Z",
  });
  assert.equal(artifact.raceIdentity, "20280229-10-04");
});

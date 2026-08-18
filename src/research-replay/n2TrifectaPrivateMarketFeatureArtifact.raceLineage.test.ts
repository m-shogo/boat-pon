import assert from "node:assert/strict";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
import type { N2TrifectaMarketRaceFeatureSequence } from "./n2TrifectaMarketFeatureEngineering.js";
import type { N2TrifectaPrivateMarketFeatureLoadReport } from "./n2TrifectaPrivateMarketFeatureLoader.js";
import { buildN2TrifectaPrivateMarketFeatureArtifact } from "./n2TrifectaPrivateMarketFeatureArtifact.js";

function report(): N2TrifectaPrivateMarketFeatureLoadReport {
  const core = {
    loaderVersion: "n2-trifecta-private-market-feature-loader-v1" as const,
    status: "PASS" as const,
    blockers: [] as string[],
    date: "2026-08-07",
    venueCode: "10",
    raceNo: 4,
    raceIdentity: "20260807-10-04",
    acceptedMarkerCount: 4,
    loadedSnapshotCount: 4,
    sequence: { status: "PASS" } as unknown as N2TrifectaMarketRaceFeatureSequence,
    networkRequestCount: 0 as const,
    databaseReadCount: 0 as const,
    databaseWriteCount: 0 as const,
    rawValuesReadPrivately: true,
    rawValuesPublished: false as const,
    privateResearchOnly: true as const,
    publicPublishAuthorized: false as const,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

function rehash(value: N2TrifectaPrivateMarketFeatureLoadReport): void {
  const { outputDigest: _outputDigest, ...core } = value;
  value.outputDigest = canonicalHash(core);
}

test("rejects feature artifacts whose path fields do not match race identity", () => {
  for (const mutate of [
    (value: N2TrifectaPrivateMarketFeatureLoadReport) => { value.date = "2026-08-08"; },
    (value: N2TrifectaPrivateMarketFeatureLoadReport) => { value.venueCode = "11"; },
    (value: N2TrifectaPrivateMarketFeatureLoadReport) => { value.raceNo = 5; },
  ]) {
    const value = report();
    mutate(value);
    rehash(value);
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
  rehash(value);
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
  rehash(value);
  const artifact = buildN2TrifectaPrivateMarketFeatureArtifact({
    report: value,
    generatedAt: "2028-02-29T02:00:00.000Z",
  });
  assert.equal(artifact.raceIdentity, "20280229-10-04");
});

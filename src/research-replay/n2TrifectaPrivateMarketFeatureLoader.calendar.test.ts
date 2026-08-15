import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadN2TrifectaPrivateMarketFeatures } from "./n2TrifectaPrivateMarketFeatureLoader";

function withTempRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-private-feature-date-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("loader rejects impossible race dates before private file access", () => {
  withTempRoot((root) => {
    const report = loadN2TrifectaPrivateMarketFeatures({
      rootDir: root,
      date: "2026-02-30",
      venueCode: "05",
      raceNo: 1,
    });

    assert.equal(report.status, "BLOCKED");
    assert.deepEqual(report.blockers, ["DATE_INVALID"]);
    assert.equal(report.acceptedMarkerCount, 0);
    assert.equal(report.loadedSnapshotCount, 0);
    assert.equal(report.rawValuesReadPrivately, false);
    assert.equal(report.networkRequestCount, 0);
    assert.equal(report.databaseReadCount, 0);
    assert.equal(report.databaseWriteCount, 0);
  });
});

test("loader preserves valid leap-day race dates", () => {
  withTempRoot((root) => {
    const report = loadN2TrifectaPrivateMarketFeatures({
      rootDir: root,
      date: "2028-02-29",
      venueCode: "05",
      raceNo: 1,
    });

    assert.equal(report.status, "NO_DATA");
    assert.deepEqual(report.blockers, []);
    assert.equal(report.rawValuesReadPrivately, false);
  });
});

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readN2MarketBaselineReadiness } from "./n2MarketBaselineReadinessReader";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-readiness-marker-time-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeAcceptedMarker(root: string, acceptedAt: string): void {
  const date = "2026-08-07";
  const venue = "10";
  const raceDir = "01";
  const relativeDir = `data/raw/research/trifecta-market/${date}/${venue}/${raceDir}/T-5`;
  const directory = join(root, relativeDir);
  mkdirSync(directory, { recursive: true });
  const rawRelativePath = `${relativeDir}/capture.html`;
  const envelopeRelativePath = `${relativeDir}/capture.envelope.json`;
  writeFileSync(join(root, rawRelativePath), "private evidence fixture\n", "utf8");
  writeFileSync(join(root, envelopeRelativePath), "{}\n", "utf8");
  writeFileSync(join(directory, "accepted.json"), `${JSON.stringify({
    markerVersion: "n2-trifecta-private-capture-accepted-v1",
    raceIdentity: "20260807-10-01",
    checkpointLabel: "T-5",
    rawDocumentId: "raw-fixture",
    rawSha256: "b".repeat(64),
    rawRelativePath,
    envelopeRelativePath,
    acceptedAt,
    databaseWriteAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`, "utf8");
}

for (const acceptedAt of [
  "2026-02-30T03:00:00.000Z",
  "2026-08-07T24:00:00.000Z",
]) {
  test(`readiness rejects normalized acceptedAt ${acceptedAt} before any raw-odds read`, () => {
    withRoot((root) => {
      writeAcceptedMarker(root, acceptedAt);
      const result = readN2MarketBaselineReadiness({ dataRoot: root });
      assert.deepEqual(result.acceptedT5RaceKeys, []);
      assert.deepEqual(result.integrityBlockedRaceKeys, ["2026-08-07:10:R1"]);
      assert.equal(result.invalidAcceptedMarkerCount, 1);
      assert.equal(result.databaseReadCount, 0);
      assert.equal(result.rawOddsValuesRead, false);
    });
  });
}

test("readiness preserves valid leap-day and timezone-offset acceptedAt forms", () => {
  withRoot((root) => {
    writeAcceptedMarker(root, "2024-02-29T12:25:30+09:00");
    const result = readN2MarketBaselineReadiness({ dataRoot: root });
    assert.deepEqual(result.acceptedT5RaceKeys, ["2026-08-07:10:R1"]);
    assert.deepEqual(result.integrityBlockedRaceKeys, []);
    assert.equal(result.invalidAcceptedMarkerCount, 0);
    assert.ok(result.sourceBlockers.includes("SIDECAR_NOT_FOUND"));
    assert.equal(result.databaseReadCount, 0);
    assert.equal(result.rawOddsValuesRead, false);
  });
});

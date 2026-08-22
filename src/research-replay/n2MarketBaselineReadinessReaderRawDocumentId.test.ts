import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readN2MarketBaselineReadiness } from "./n2MarketBaselineReadinessReader";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-readiness-raw-id-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeMarker(root: string, rawDocumentId: string): void {
  const date = "2026-08-07";
  const venue = "10";
  const raceDir = "01";
  const relativeDir = `data/raw/research/trifecta-market/${date}/${venue}/${raceDir}/T-5`;
  const directory = join(root, relativeDir);
  mkdirSync(directory, { recursive: true });
  const rawRelativePath = `${relativeDir}/capture.html`;
  const envelopeRelativePath = `${relativeDir}/capture.envelope.json`;
  writeFileSync(join(root, rawRelativePath), "synthetic raw fixture\n", "utf8");
  writeFileSync(join(root, envelopeRelativePath), "{}\n", "utf8");
  writeFileSync(join(directory, "accepted.json"), `${JSON.stringify({
    markerVersion: "n2-trifecta-private-capture-accepted-v1",
    manifestDigest: "a".repeat(64),
    checkpointKey: "b".repeat(64),
    raceIdentity: "20260807-10-01",
    checkpointLabel: "T-5",
    rawDocumentId,
    rawSha256: "b".repeat(64),
    rawRelativePath,
    envelopeRelativePath,
    acceptedAt: "2026-08-07T03:00:00.000Z",
    databaseWriteAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`, "utf8");
}

for (const rawDocumentId of ["   ", " raw-document-id", "raw-document-id "]) {
  test(`accepted marker rejects non-canonical rawDocumentId ${JSON.stringify(rawDocumentId)}`, () => {
    withRoot((root) => {
      writeMarker(root, rawDocumentId);
      const result = readN2MarketBaselineReadiness({ dataRoot: root });
      assert.deepEqual(result.acceptedT5RaceKeys, []);
      assert.deepEqual(result.integrityBlockedRaceKeys, ["2026-08-07:10:R1"]);
      assert.equal(result.acceptedMarkerCount, 0);
      assert.equal(result.invalidAcceptedMarkerCount, 1);
      assert.equal(result.databaseReadCount, 0);
      assert.equal(result.rawOddsValuesRead, false);
    });
  });
}

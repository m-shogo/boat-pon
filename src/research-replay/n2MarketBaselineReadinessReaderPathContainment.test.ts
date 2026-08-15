import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readN2MarketBaselineReadiness } from "./n2MarketBaselineReadinessReader";

test("readiness rejects normalized T-5 evidence traversal instead of counting the marker", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-readiness-containment-"));
  try {
    const directory = "data/raw/research/trifecta-market/2026-08-07/05/01/T-5";
    const markerDir = join(root, directory);
    mkdirSync(markerDir, { recursive: true });

    writeFileSync(join(markerDir, "accepted.json"), `${JSON.stringify({
      markerVersion: "n2-trifecta-private-capture-accepted-v1",
      raceIdentity: "20260807-05-01",
      checkpointLabel: "T-5",
      rawDocumentId: "rr-raw-fixture",
      rawSha256: "a".repeat(64),
      rawRelativePath: `${directory}/../../foreign.html`,
      envelopeRelativePath: `${directory}/../../foreign.envelope.json`,
      acceptedAt: "2026-08-07T03:31:00.000Z",
      databaseWriteAuthorized: false,
      productionApplyExecuted: false,
    }, null, 2)}\n`, "utf8");

    const escapedDir = join(root, "data/raw/research/trifecta-market/2026-08-07/05");
    mkdirSync(escapedDir, { recursive: true });
    writeFileSync(join(escapedDir, "foreign.html"), "private fixture evidence", "utf8");
    writeFileSync(join(escapedDir, "foreign.envelope.json"), "{}\n", "utf8");

    const read = readN2MarketBaselineReadiness({ dataRoot: root });

    assert.deepEqual(read.acceptedT5RaceKeys, []);
    assert.equal(read.acceptedMarkerCount, 0);
    assert.equal(read.invalidAcceptedMarkerCount, 1);
    assert.deepEqual(read.integrityBlockedRaceKeys, ["2026-08-07:05:R1"]);
    assert.equal(read.databaseReadCount, 0);
    assert.equal(read.rawOddsValuesRead, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

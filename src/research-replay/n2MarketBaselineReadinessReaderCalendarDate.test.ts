import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readN2MarketBaselineReadiness } from "./n2MarketBaselineReadinessReader";

function writeAcceptedMarker(root: string, date: string): void {
  const directory = `data/raw/research/trifecta-market/${date}/05/01/T-5`;
  const markerDir = join(root, directory);
  mkdirSync(markerDir, { recursive: true });
  writeFileSync(join(markerDir, "fixture.html"), "private fixture evidence", "utf8");
  writeFileSync(join(markerDir, "fixture.envelope.json"), "{}\n", "utf8");
  writeFileSync(join(markerDir, "accepted.json"), `${JSON.stringify({
    markerVersion: "n2-trifecta-private-capture-accepted-v1",
    raceIdentity: `${date.replaceAll("-", "")}-05-01`,
    checkpointLabel: "T-5",
    rawDocumentId: `raw-${date}`,
    rawSha256: "a".repeat(64),
    rawRelativePath: `${directory}/fixture.html`,
    envelopeRelativePath: `${directory}/fixture.envelope.json`,
    acceptedAt: "2024-02-29T03:25:30.000Z",
    databaseWriteAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`, "utf8");
}

test("readiness rejects impossible private capture date directories while preserving leap days", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-readiness-calendar-date-"));
  try {
    writeAcceptedMarker(root, "2026-02-30");
    writeAcceptedMarker(root, "2024-02-29");

    const read = readN2MarketBaselineReadiness({ dataRoot: root });

    assert.deepEqual(read.acceptedT5RaceKeys, ["2024-02-29:05:R1"]);
    assert.equal(read.acceptedMarkerCount, 1);
    assert.ok(read.sourceBlockers.includes("PRIVATE_CAPTURE_DATE_INVALID:2026-02-30"));
    assert.ok(read.sourceBlockers.includes("SIDECAR_NOT_FOUND"));
    assert.equal(read.databaseReadCount, 0);
    assert.equal(read.rawOddsValuesRead, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

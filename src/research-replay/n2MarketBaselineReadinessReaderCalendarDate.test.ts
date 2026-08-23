import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { buildBoatRaceOfficialSourceUrl } from "./n2ExternalSourceCaptureContract";
import { readN2MarketBaselineReadiness } from "./n2MarketBaselineReadinessReader";

function writeAcceptedMarker(root: string, date: string): void {
  const venue = "05";
  const raceDir = "01";
  const raceIdentity = `${date.replaceAll("-", "")}-${venue}-${raceDir}`;
  const directory = `data/raw/research/trifecta-market/${date}/${venue}/${raceDir}/T-5`;
  const markerDir = join(root, directory);
  mkdirSync(markerDir, { recursive: true });
  const rawRelativePath = `${directory}/fixture.html`;
  const envelopeRelativePath = `${directory}/fixture.envelope.json`;
  const manifestDigest = "a".repeat(64);
  const decisionCutoff = `${date}T03:30:00.000Z`;
  const targetCaptureAt = new Date(Date.parse(decisionCutoff) - 5 * 60_000).toISOString();
  const sourceUrl = buildBoatRaceOfficialSourceUrl(
    "boatrace_official_trifecta_odds_html",
    { date: date.replaceAll("-", ""), venueCode: venue, raceNo: 1 },
  );
  const checkpointKey = canonicalHash({
    manifestDigest,
    raceIdentity,
    checkpointLabel: "T-5",
    targetCaptureAt,
    sourceUrl,
  });
  writeFileSync(join(root, rawRelativePath), "private fixture evidence", "utf8");
  writeFileSync(join(root, envelopeRelativePath), `${JSON.stringify({
    envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
    status: "PASS",
    blockers: [],
    manifestDigest,
    checkpointKey,
    entry: {
      raceIdentity,
      checkpointLabel: "T-5",
      decisionCutoff,
    },
    response: { fetchedAt: `${date}T03:25:30.000Z` },
    sourceDisplayedUpdate: { availableAt: `${date}T03:24:00.000Z` },
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`, "utf8");
  writeFileSync(join(markerDir, "accepted.json"), `${JSON.stringify({
    markerVersion: "n2-trifecta-private-capture-accepted-v1",
    manifestDigest,
    checkpointKey,
    raceIdentity,
    checkpointLabel: "T-5",
    rawDocumentId: `raw-${date}`,
    rawSha256: "a".repeat(64),
    rawRelativePath,
    envelopeRelativePath,
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
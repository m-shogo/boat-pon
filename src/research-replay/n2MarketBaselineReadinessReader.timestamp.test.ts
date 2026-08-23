import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { buildBoatRaceOfficialSourceUrl } from "./n2ExternalSourceCaptureContract";
import { readN2MarketBaselineReadiness } from "./n2MarketBaselineReadinessReader";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-readiness-marker-time-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeAcceptedMarker(root: string, acceptedAt: string, date = "2026-08-07"): void {
  const venue = "10";
  const raceDir = "01";
  const raceIdentity = `${date.replaceAll("-", "")}-${venue}-${raceDir}`;
  const relativeDir = `data/raw/research/trifecta-market/${date}/${venue}/${raceDir}/T-5`;
  const directory = join(root, relativeDir);
  mkdirSync(directory, { recursive: true });
  const rawRelativePath = `${relativeDir}/capture.html`;
  const envelopeRelativePath = `${relativeDir}/capture.envelope.json`;
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
  writeFileSync(join(root, rawRelativePath), "private evidence fixture\n", "utf8");
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
  writeFileSync(join(directory, "accepted.json"), `${JSON.stringify({
    markerVersion: "n2-trifecta-private-capture-accepted-v1",
    manifestDigest,
    checkpointKey,
    raceIdentity,
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
  "2026-08-07T03:25:30.000",
  "2026-08-07 03:25:30+09:00",
  "2026-08-06T03:25:30.000Z",
]) {
  test(`readiness rejects invalid or out-of-race-date acceptedAt ${acceptedAt} before any raw-odds read`, () => {
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

test("readiness preserves valid explicit-offset acceptedAt within the race date", () => {
  withRoot((root) => {
    writeAcceptedMarker(root, "2026-08-07T12:25:30+09:00");
    const result = readN2MarketBaselineReadiness({ dataRoot: root });
    assert.deepEqual(result.acceptedT5RaceKeys, ["2026-08-07:10:R1"]);
    assert.deepEqual(result.integrityBlockedRaceKeys, []);
    assert.equal(result.invalidAcceptedMarkerCount, 0);
    assert.ok(result.sourceBlockers.includes("SIDECAR_NOT_FOUND"));
    assert.equal(result.databaseReadCount, 0);
    assert.equal(result.rawOddsValuesRead, false);
  });
});

test("readiness preserves a valid leap-day acceptedAt when the race date is the same leap day", () => {
  withRoot((root) => {
    writeAcceptedMarker(root, "2024-02-29T12:25:30+09:00", "2024-02-29");
    const result = readN2MarketBaselineReadiness({ dataRoot: root });
    assert.deepEqual(result.acceptedT5RaceKeys, ["2024-02-29:10:R1"]);
    assert.deepEqual(result.integrityBlockedRaceKeys, []);
    assert.equal(result.invalidAcceptedMarkerCount, 0);
    assert.ok(result.sourceBlockers.includes("SIDECAR_NOT_FOUND"));
    assert.equal(result.databaseReadCount, 0);
    assert.equal(result.rawOddsValuesRead, false);
  });
});

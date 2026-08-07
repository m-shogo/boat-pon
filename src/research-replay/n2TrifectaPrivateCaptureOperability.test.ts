import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { buildN2TrifectaOddsCheckpointPlan } from "./n2TrifectaOddsCheckpointCollection.js";
import {
  buildN2TrifectaPrivateDailyPlanCache,
  buildN2TrifectaPrivateDailyPlanSourceEvidence,
  writeN2TrifectaPrivateDailyPlanCache,
} from "./n2TrifectaPrivateDailyPlanCache.js";
import { buildN2TrifectaPrivateCaptureOperabilityReport } from
  "./n2TrifectaPrivateCaptureOperability.js";

function writeJson(root: string, relativePath: string, value: unknown): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

test("operability report classifies mature checkpoint coverage without reading raw odds", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-operability-"));
  try {
    const plan = buildN2TrifectaOddsCheckpointPlan({
      stage: "ONE_VENUE_REVIEW",
      races: Array.from({ length: 12 }, (_, index) => ({
        date: "2026-08-07",
        venueCode: "10",
        raceNo: index + 1,
        closeAt: "10:05",
      })),
    });
    const cache = buildN2TrifectaPrivateDailyPlanCache({
      date: "2026-08-07",
      generatedAt: "2026-08-07T00:00:00.000Z",
      plans: [plan],
      source: buildN2TrifectaPrivateDailyPlanSourceEvidence({
        primaryDbBytes: 123_456,
        primaryDbModifiedMs: 1_786_000_000_000,
        primaryDbWalBytes: 0,
      }),
    });
    writeN2TrifectaPrivateDailyPlanCache({ dataRoot: root, cache });

    writeJson(root, "data/private/trifecta-capture/authorization.json", {
      authorizationVersion: "n2-trifecta-local-capture-authorization-v1",
      authorizationId: "AUTH-N2-TRI-LOCAL-operability-test",
      issuedAt: "2026-08-07T00:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
      stage: "ONE_VENUE_REVIEW",
      maxRequestsPerDay: 48,
      checkpointLabels: ["T-30", "T-20", "T-10", "T-5"],
      minInterRequestMs: 10_000,
      privateResearchOnly: true,
      publicRedistributionAuthorized: false,
      databaseWriteAuthorized: false,
      currentBuyConnectionAuthorized: false,
      lineConnectionAuthorized: false,
      automatedBettingAuthorized: false,
    });
    writeJson(root, "data/private/trifecta-capture/runtime-authority.json", {
      authoritySha: "6e297602ff34d6cc853ff0e7088ae5a3e56fcfb7",
    });
    writeJson(root, "data/private/trifecta-capture/status/latest.json", {
      latestStatusVersion: "n2-trifecta-local-capture-latest-v1",
      checkedAt: "2026-08-07T00:37:30.000Z",
      report: { status: "NO_CHANGE" },
    });
    writeJson(root, "data/private/trifecta-capture/reports/2026-08-07/pass.json", {
      status: "PASS",
      completedAt: "2026-08-07T00:36:00.000Z",
    });
    writeJson(root, "data/private/trifecta-capture/reports/2026-08-07/blocked.json", {
      status: "BLOCKED",
      completedAt: "2026-08-07T00:35:30.000Z",
      executorReport: {
        entryResults: [{
          raceIdentity: "20260807-10-02",
          checkpointLabel: "T-30",
          result: "BLOCKED_EVIDENCE_SAVED",
          blockers: ["PARSED_SELECTION_COUNT_NOT_120"],
        }],
      },
    });

    const acceptedDirectory = "data/raw/research/trifecta-market/2026-08-07/10/01/T-30";
    writeJson(root, `${acceptedDirectory}/accepted.json`, {
      markerVersion: "n2-trifecta-private-capture-accepted-v1",
      checkpointKey: "a".repeat(64),
      raceIdentity: "20260807-10-01",
      checkpointLabel: "T-30",
      rawSha256: "b".repeat(64),
      rawRelativePath: `${acceptedDirectory}/capture.html`,
      envelopeRelativePath: `${acceptedDirectory}/capture.envelope.json`,
      acceptedAt: "2026-08-07T00:35:20.000Z",
      databaseWriteAuthorized: false,
      productionApplyExecuted: false,
    });

    // Operability must not open envelope/raw market payloads. Invalid envelope JSON is harmless here
    // because blocked taxonomy is derived from the sanitized local tick report metadata instead.
    const ignoredEnvelopePath = join(
      root,
      "data/raw/research/trifecta-market/2026-08-07/10/04/T-30/ignored.envelope.json",
    );
    mkdirSync(dirname(ignoredEnvelopePath), { recursive: true, mode: 0o700 });
    writeFileSync(ignoredEnvelopePath, "not-json-and-must-never-be-read", { encoding: "utf8", mode: 0o600 });

    writeJson(root, "data/private/trifecta-capture/reservations/2026-08-07/reservation.json", {
      reservationVersion: "n2-trifecta-local-capture-reservation-v1",
      authorizationId: "AUTH-N2-TRI-LOCAL-operability-test",
      date: "2026-08-07",
      venueCode: "10",
      raceIdentity: "20260807-10-03",
      checkpointLabel: "T-30",
      targetCaptureAt: "2026-08-07T00:35:00.000Z",
      reservationKey: "c".repeat(64),
      reservedAt: "2026-08-07T00:35:00.000Z",
      networkRequestCeiling: 1,
    });

    const report = buildN2TrifectaPrivateCaptureOperabilityReport({
      dataRoot: root,
      date: "2026-08-07",
      now: "2026-08-07T00:38:00.000Z",
      launchdRegistered: true,
    });

    assert.equal(report.status, "DEGRADED");
    assert.deepEqual(report.blockers, []);
    assert.equal(report.selectedVenueCode, "10");
    assert.equal(report.authoritySha, "6e297602ff34d6cc853ff0e7088ae5a3e56fcfb7");
    assert.equal(report.launchdRegistered, true);
    assert.equal(report.authorization.present, true);
    assert.equal(report.authorization.maxRequestsPerDay, 48);
    assert.equal(report.authorization.expiryWarning, false);
    assert.equal(report.heartbeat.latestStatusPresent, true);
    assert.equal(report.heartbeat.stale, false);
    assert.equal(report.heartbeat.lastSuccessfulTickAt, "2026-08-07T00:36:00.000Z");
    assert.equal(report.coverage.expectedCheckpointCount, 48);
    assert.equal(report.coverage.maturedCheckpointCount, 12);
    assert.equal(report.coverage.acceptedCount, 1);
    assert.equal(report.coverage.blockedEvidenceCount, 1);
    assert.equal(report.coverage.reservedNoAcceptedEvidenceCount, 1);
    assert.equal(report.coverage.missedNoReservationCount, 9);
    assert.equal(report.coverage.pendingCount, 36);
    assert.equal(report.coverage.attemptedMaturedCount, 3);
    assert.equal(report.coverage.attemptedMaturedRatio, 0.25);
    assert.equal(report.coverage.acceptedMaturedRatio, 0.083333);
    assert.equal(report.coverage.consecutiveMissedCheckpointCount, 9);
    assert.equal(report.networkRequestCount, 0);
    assert.equal(report.databaseReadCount, 0);
    assert.equal(report.databaseWriteCount, 0);
    assert.equal(report.rawOddsValuesRead, false);
    assert.equal(report.rawOddsValuesPrinted, false);
    assert.equal(report.rawOddsValuesPublished, false);
    assert.equal(report.currentBuyChanged, false);
    assert.equal(report.lineChanged, false);
    assert.equal(report.publicPublished, false);
    assert.equal(report.automatedBettingChanged, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid accepted marker is blocked instead of being counted as accepted", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-operability-invalid-marker-"));
  try {
    const plan = buildN2TrifectaOddsCheckpointPlan({
      stage: "ONE_VENUE_REVIEW",
      races: Array.from({ length: 12 }, (_, index) => ({
        date: "2026-08-07",
        venueCode: "10",
        raceNo: index + 1,
        closeAt: "10:05",
      })),
    });
    const cache = buildN2TrifectaPrivateDailyPlanCache({
      date: "2026-08-07",
      generatedAt: "2026-08-07T00:00:00.000Z",
      plans: [plan],
      source: buildN2TrifectaPrivateDailyPlanSourceEvidence({
        primaryDbBytes: 123_456,
        primaryDbModifiedMs: 1_786_000_000_000,
        primaryDbWalBytes: 0,
      }),
    });
    writeN2TrifectaPrivateDailyPlanCache({ dataRoot: root, cache });
    writeJson(root, "data/private/trifecta-capture/authorization.json", {
      expiresAt: "2026-09-01T00:00:00.000Z",
      maxRequestsPerDay: 48,
    });
    writeJson(root, "data/private/trifecta-capture/runtime-authority.json", {
      authoritySha: "6e297602ff34d6cc853ff0e7088ae5a3e56fcfb7",
    });
    writeJson(root, "data/private/trifecta-capture/status/latest.json", {
      checkedAt: "2026-08-07T00:37:30.000Z",
      report: { status: "NO_CHANGE" },
    });
    writeJson(root, "data/raw/research/trifecta-market/2026-08-07/10/01/T-30/accepted.json", {
      markerVersion: "n2-trifecta-private-capture-accepted-v1",
      checkpointKey: "not-a-digest",
      raceIdentity: "wrong-race",
      checkpointLabel: "T-30",
      rawSha256: "not-a-digest",
      databaseWriteAuthorized: false,
      productionApplyExecuted: false,
    });

    const report = buildN2TrifectaPrivateCaptureOperabilityReport({
      dataRoot: root,
      date: "2026-08-07",
      now: "2026-08-07T00:38:00.000Z",
      launchdRegistered: true,
    });
    assert.equal(report.status, "BLOCKED");
    assert.equal(report.coverage.acceptedCount, 0);
    assert.ok(report.blockers.includes("ACCEPTED_MARKER_CHECKPOINT_KEY_INVALID"));
    assert.ok(report.blockers.includes("ACCEPTED_MARKER_RACE_IDENTITY_MISMATCH"));
    assert.ok(report.blockers.includes("ACCEPTED_MARKER_RAW_SHA256_INVALID"));
    assert.equal(report.rawOddsValuesRead, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

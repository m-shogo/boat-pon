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

import { canonicalHash } from "./canonical.js";
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

function writeVerifiedCaptureReport(input: {
  root: string;
  date: string;
  status: "PASS" | "NO_CHANGE" | "BLOCKED";
  completedAt: string;
  selectedVenueCode?: string | null;
  entryResults?: Array<{
    raceIdentity: string;
    checkpointLabel: string;
    result: "BLOCKED_EVIDENCE_SAVED";
    blockers: string[];
  }>;
}): string {
  const entryResults = input.entryResults ?? [];
  const selected = entryResults[0] ?? null;
  const executorReport = entryResults.length === 0
    ? null
    : (() => {
      const core = {
        reportVersion: "n2-trifecta-private-capture-run-v1",
        executorVersion: "n2-trifecta-private-capture-executor-test-fixture",
        status: input.status === "BLOCKED" ? "BLOCKED" as const : "PASS" as const,
        executionMode: "execute" as const,
        startedAt: input.completedAt,
        completedAt: input.completedAt,
        manifestDigest: "d".repeat(64),
        approvalId: null,
        approvalAudit: { status: "PASS" },
        dueEntryCount: entryResults.length,
        networkRequestCount: 0,
        capturedCount: 0,
        blockedEvidenceCount: entryResults.length,
        skippedCount: 0,
        stoppedEarly: false,
        blockers: [] as string[],
        entryResults,
        ledgerRelativePath: "data/private/trifecta-capture/attempts/test.jsonl",
        databaseWriteCount: 0 as const,
        primaryDbWriteCount: 0 as const,
        sidecarWriteCount: 0 as const,
        currentBuyChanged: false as const,
        lineChanged: false as const,
        publicPublished: false as const,
        automatedBettingChanged: false as const,
        productionApplyExecuted: false as const,
      };
      return { ...core, outputDigest: canonicalHash(core) };
    })();
  const authorizationAudit = { status: "PASS" as const };
  const eventDigest = canonicalHash({
    status: input.status,
    blockers: [],
    dateJst: input.date,
    authorizationStatus: authorizationAudit.status,
    selectedVenueCode: input.selectedVenueCode ?? "10",
    selectedRaceIdentity: selected?.raceIdentity ?? null,
    selectedCheckpointLabel: selected?.checkpointLabel ?? null,
    executorStatus: executorReport?.status ?? null,
    executorOutputDigest: executorReport?.outputDigest ?? null,
    primaryDbMetadataUnchanged: true,
  });
  const relativePath = `data/private/trifecta-capture/reports/${input.date}/${eventDigest}.json`;
  const core = {
    reportVersion: "n2-trifecta-local-capture-report-v1.1",
    serviceVersion: "n2-trifecta-local-capture-service-v1.1",
    status: input.status,
    blockers: [] as string[],
    startedAt: input.completedAt,
    completedAt: input.completedAt,
    now: input.completedAt,
    dateJst: input.date,
    authorizationAudit,
    selectedVenueCode: input.selectedVenueCode ?? "10",
    selectedSourcePlanDigest: "d".repeat(64),
    selectedRaceCount: 12,
    dailyReservationCountBefore: 0,
    dailyReservationCountAfter: 0,
    dueEntryCount: entryResults.length,
    selectedEntry: selected,
    singleEntryPlanDigest: executorReport ? "d".repeat(64) : null,
    ephemeralApprovalId: null,
    executorReport,
    selectionRelativePath: null,
    reservationRelativePath: null,
    reportRelativePath: relativePath,
    latestStatusRelativePath: "data/private/trifecta-capture/status/latest.json",
    eventDigest,
    eventChanged: true,
    primaryDbMetadataUnchanged: true,
    databaseWriteCount: 0 as const,
    primaryDbWriteCount: 0 as const,
    sidecarWriteCount: 0 as const,
    currentBuyChanged: false as const,
    lineChanged: false as const,
    publicPublished: false as const,
    automatedBettingChanged: false as const,
    productionApplyExecuted: false as const,
  };
  writeJson(input.root, relativePath, { ...core, outputDigest: canonicalHash(core) });
  return relativePath;
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

    const authorizationId = "AUTH-N2-TRI-LOCAL-operability-test";
    writeJson(root, "data/private/trifecta-capture/authorization.json", {
      authorizationVersion: "n2-trifecta-local-capture-authorization-v1",
      authorizationId,
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
    writeVerifiedCaptureReport({
      root,
      date: "2026-08-07",
      status: "PASS",
      completedAt: "2026-08-07T00:36:00.000Z",
    });
    writeVerifiedCaptureReport({
      root,
      date: "2026-08-07",
      status: "BLOCKED",
      completedAt: "2026-08-07T00:35:30.000Z",
      entryResults: [{
        raceIdentity: "20260807-10-02",
        checkpointLabel: "T-30",
        result: "BLOCKED_EVIDENCE_SAVED",
        blockers: ["PARSED_SELECTION_COUNT_NOT_120"],
      }],
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

    const ignoredEnvelopePath = join(
      root,
      "data/raw/research/trifecta-market/2026-08-07/10/04/T-30/ignored.envelope.json",
    );
    mkdirSync(dirname(ignoredEnvelopePath), { recursive: true, mode: 0o700 });
    writeFileSync(ignoredEnvelopePath, "not-json-and-must-never-be-read", { encoding: "utf8", mode: 0o600 });

    const reservation = {
      reservationVersion: "n2-trifecta-local-capture-reservation-v1",
      authorizationId,
      date: "2026-08-07",
      venueCode: "10",
      raceIdentity: "20260807-10-03",
      checkpointLabel: "T-30",
      targetCaptureAt: "2026-08-07T00:35:00.000Z",
      reservedAt: "2026-08-07T00:35:00.000Z",
      networkRequestCeiling: 1,
    };
    const reservationKey = canonicalHash({
      authorizationId: reservation.authorizationId,
      raceIdentity: reservation.raceIdentity,
      checkpointLabel: reservation.checkpointLabel,
      targetCaptureAt: reservation.targetCaptureAt,
    });
    writeJson(root, `data/private/trifecta-capture/reservations/2026-08-07/${reservationKey}.json`, {
      ...reservation,
      reservationKey,
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

test("invalid accepted marker, forged reservation, and forged capture report cannot inflate coverage or heartbeat", () => {
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
      authorizationId: "AUTH-N2-TRI-LOCAL-operability-test",
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
    writeJson(root, "data/private/trifecta-capture/reservations/2026-08-07/forged.json", {
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
    writeJson(root, "data/private/trifecta-capture/reports/2026-08-07/forged.json", {
      status: "PASS",
      completedAt: "2026-08-07T00:37:00.000Z",
      executorReport: {
        entryResults: [{
          raceIdentity: "20260807-10-04",
          checkpointLabel: "T-30",
          result: "BLOCKED_EVIDENCE_SAVED",
          blockers: ["FORGED_BLOCKER"],
        }],
      },
    });

    const report = buildN2TrifectaPrivateCaptureOperabilityReport({
      dataRoot: root,
      date: "2026-08-07",
      now: "2026-08-07T00:38:00.000Z",
      launchdRegistered: true,
    });
    assert.equal(report.status, "BLOCKED");
    assert.equal(report.heartbeat.lastSuccessfulTickAt, null);
    assert.equal(report.coverage.acceptedCount, 0);
    assert.equal(report.coverage.blockedEvidenceCount, 1);
    assert.equal(report.coverage.reservedNoAcceptedEvidenceCount, 0);
    const forgedReportCheckpoint = report.checkpoints.find(
      (checkpoint) => checkpoint.raceIdentity === "20260807-10-04"
        && checkpoint.checkpointLabel === "T-30",
    );
    assert.equal(forgedReportCheckpoint?.state, "MISSED_NO_RESERVATION");
    assert.deepEqual(forgedReportCheckpoint?.blockerCodes, []);
    assert.ok(report.blockers.includes("RESERVATION_METADATA_INVALID"));
    assert.ok(report.blockers.includes("CAPTURE_REPORT_METADATA_INVALID"));
    assert.ok(report.blockers.includes("ACCEPTED_MARKER_CHECKPOINT_KEY_INVALID"));
    assert.ok(report.blockers.includes("ACCEPTED_MARKER_RACE_IDENTITY_MISMATCH"));
    assert.ok(report.blockers.includes("ACCEPTED_MARKER_RAW_SHA256_INVALID"));
    assert.equal(report.rawOddsValuesRead, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
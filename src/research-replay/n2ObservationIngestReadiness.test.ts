import assert from "node:assert/strict";
import test from "node:test";
import {
  buildN2ObservationIngestReadiness,
  N2_OFFICIAL_PROGRAM_CANARY_APPROVAL,
  N2_TRIFECTA_MARKET_CANARY_APPROVAL,
  type N2ObservationIngestReadinessInput,
} from "./n2ObservationIngestReadiness";

function baseInput(): N2ObservationIngestReadinessInput {
  return {
    cohort: { dateFrom: "2026-07-30", dateTo: "2026-08-05", dayCount: 7 },
    primaryOfficialProgram: {
      totalRows: 300,
      eligibleRows: 300,
      missingRawJson: 0,
      missingSourceFile: 0,
      missingImportedAt: 0,
      missingCloseAt: 0,
    },
    primaryTrifectaMarket: {
      sourceTablePresent: true,
      totalRows: 2_400,
      raceCount: 20,
      validTimingRows: 2_400,
      validSelectionRows: 2_400,
      completeSnapshotCount: 20,
      rawLineageCompleteSnapshotCount: 0,
      rawDocumentIdColumnPresent: false,
      rawPayloadColumnPresent: false,
      rawPayloadDigestColumnPresent: false,
      parseRunIdColumnPresent: false,
      sourceUrlColumnPresent: false,
      availableAtColumnPresent: false,
      decisionCutoffColumnPresent: false,
    },
    sidecar: {
      officialProgramObservationCount: 0,
      trifectaMarketObservationCount: 0,
      captureAttemptCount: 0,
      outboxMessageCount: 0,
      deliveryAttemptCount: 0,
    },
    rollout: {
      shadowWriteEnabled: false,
      operationalGcEnabled: false,
      killSwitchEngaged: false,
      approvalScopes: [],
    },
    wiring: {
      officialProgramCaptureImplemented: true,
      officialProgramProductionCallerConnected: false,
      trifectaMarketWriterImplemented: false,
    },
  };
}

function enableCanary(input: N2ObservationIngestReadinessInput): void {
  input.rollout.shadowWriteEnabled = true;
  input.rollout.approvalScopes = [
    N2_OFFICIAL_PROGRAM_CANARY_APPROVAL,
    N2_TRIFECTA_MARKET_CANARY_APPROVAL,
  ];
  input.wiring.officialProgramProductionCallerConnected = true;
  input.wiring.trifectaMarketWriterImplemented = true;
}

function enableFullRawLineage(input: N2ObservationIngestReadinessInput): void {
  input.primaryTrifectaMarket.rawDocumentIdColumnPresent = true;
  input.primaryTrifectaMarket.rawPayloadColumnPresent = true;
  input.primaryTrifectaMarket.rawPayloadDigestColumnPresent = true;
  input.primaryTrifectaMarket.parseRunIdColumnPresent = true;
  input.primaryTrifectaMarket.sourceUrlColumnPresent = true;
  input.primaryTrifectaMarket.availableAtColumnPresent = true;
  input.primaryTrifectaMarket.decisionCutoffColumnPresent = true;
  input.primaryTrifectaMarket.rawLineageCompleteSnapshotCount = input.primaryTrifectaMarket.completeSnapshotCount;
}

test("realistic current state is blocked without authorizing writes", () => {
  const summary = buildN2ObservationIngestReadiness(baseInput());
  assert.equal(summary.overallStatus, "BLOCKED_NOT_READY_FOR_WRITE");
  assert.equal(summary.writeAuthorized, false);
  assert.equal(summary.autoEnableShadowWrite, false);
  assert.equal(summary.recommendedCanaryMaxRaces, 20);
  assert.match(summary.officialProgram.blockers.join("\n"), /SHADOW_WRITE_DISABLED/);
  assert.match(summary.officialProgram.blockers.join("\n"), /APPROVAL_REQUIRED:N2_OFFICIAL_PROGRAM_OBSERVATION_CANARY/);
  assert.match(summary.officialProgram.blockers.join("\n"), /OFFICIAL_PROGRAM_PRODUCTION_CALLER_NOT_CONNECTED/);
  assert.match(summary.trifectaMarket.blockers.join("\n"), /TRIFECTA_MARKET_RAW_LINEAGE_UNAVAILABLE/);
  assert.match(summary.trifectaMarket.blockers.join("\n"), /TRIFECTA_MARKET_WRITER_NOT_IMPLEMENTED/);
  assert.equal(summary.officialProgram.rawPayloadCoverage, 1);
});

test("market aggregate rows never become ready without raw lineage", () => {
  const input = baseInput();
  enableCanary(input);
  const summary = buildN2ObservationIngestReadiness(input);
  assert.equal(summary.officialProgram.status, "READY_FOR_BOUNDED_CANARY");
  assert.equal(summary.trifectaMarket.status, "BLOCKED_NOT_READY");
  assert.deepEqual(summary.trifectaMarket.blockers, ["TRIFECTA_MARKET_RAW_LINEAGE_UNAVAILABLE"]);
  assert.match(summary.nextActions.join("\n"), /Capture live trifecta raw source documents/);
});

test("raw lineage columns alone do not prove lineage-bearing snapshots", () => {
  const input = baseInput();
  enableCanary(input);
  input.primaryTrifectaMarket.rawDocumentIdColumnPresent = true;
  input.primaryTrifectaMarket.rawPayloadColumnPresent = true;
  input.primaryTrifectaMarket.rawPayloadDigestColumnPresent = true;
  input.primaryTrifectaMarket.parseRunIdColumnPresent = true;
  input.primaryTrifectaMarket.sourceUrlColumnPresent = true;
  input.primaryTrifectaMarket.availableAtColumnPresent = true;
  input.primaryTrifectaMarket.decisionCutoffColumnPresent = true;
  const summary = buildN2ObservationIngestReadiness(input);
  assert.equal(summary.trifectaMarket.rawLineageCompleteSnapshotCount, 0);
  assert.equal(summary.trifectaMarket.rawLineageCapable, false);
  assert.deepEqual(summary.trifectaMarket.blockers, ["TRIFECTA_MARKET_RAW_LINEAGE_UNAVAILABLE"]);
});

test("raw lineage without source URL provenance stays blocked", () => {
  const input = baseInput();
  enableCanary(input);
  enableFullRawLineage(input);
  input.primaryTrifectaMarket.sourceUrlColumnPresent = false;
  const summary = buildN2ObservationIngestReadiness(input);
  assert.equal(summary.trifectaMarket.rawLineageCompleteSnapshotCount, 20);
  assert.equal(summary.trifectaMarket.rawLineageCapable, false);
  assert.deepEqual(summary.trifectaMarket.blockers, ["TRIFECTA_MARKET_RAW_LINEAGE_UNAVAILABLE"]);
});

test("raw lineage without atomic PIT columns stays blocked", () => {
  const input = baseInput();
  enableCanary(input);
  enableFullRawLineage(input);
  input.primaryTrifectaMarket.availableAtColumnPresent = false;
  const missingAvailableAt = buildN2ObservationIngestReadiness(input);
  assert.equal(missingAvailableAt.trifectaMarket.rawLineageCapable, false);
  assert.deepEqual(missingAvailableAt.trifectaMarket.blockers, ["TRIFECTA_MARKET_RAW_LINEAGE_UNAVAILABLE"]);

  input.primaryTrifectaMarket.availableAtColumnPresent = true;
  input.primaryTrifectaMarket.decisionCutoffColumnPresent = false;
  const missingDecisionCutoff = buildN2ObservationIngestReadiness(input);
  assert.equal(missingDecisionCutoff.trifectaMarket.rawLineageCapable, false);
  assert.deepEqual(missingDecisionCutoff.trifectaMarket.blockers, ["TRIFECTA_MARKET_RAW_LINEAGE_UNAVAILABLE"]);
});

test("fully approved, wired and raw-lineage capable sources become canary-ready only", () => {
  const input = baseInput();
  enableCanary(input);
  enableFullRawLineage(input);
  const summary = buildN2ObservationIngestReadiness(input);
  assert.equal(summary.overallStatus, "READY_FOR_BOUNDED_CANARY");
  assert.equal(summary.officialProgram.status, "READY_FOR_BOUNDED_CANARY");
  assert.equal(summary.trifectaMarket.status, "READY_FOR_BOUNDED_CANARY");
  assert.equal(summary.trifectaMarket.rawLineageCompleteSnapshotCount, 20);
  assert.equal(summary.writeAuthorized, false);
  assert.equal(summary.recommendedCanaryMaxRaces, 20);
});

test("kill switch blocks both sources even with approvals", () => {
  const input = baseInput();
  enableCanary(input);
  enableFullRawLineage(input);
  input.rollout.killSwitchEngaged = true;
  const summary = buildN2ObservationIngestReadiness(input);
  assert.match(summary.officialProgram.blockers.join("\n"), /KILL_SWITCH_ENGAGED/);
  assert.match(summary.trifectaMarket.blockers.join("\n"), /KILL_SWITCH_ENGAGED/);
});

test("invalid counts, cohort and duplicate approvals fail closed", () => {
  const negative = baseInput();
  negative.primaryOfficialProgram.totalRows = -1;
  assert.throws(() => buildN2ObservationIngestReadiness(negative), /non-negative safe integer/);

  const invalidLineageCount = baseInput();
  invalidLineageCount.primaryTrifectaMarket.rawLineageCompleteSnapshotCount = 21;
  assert.throws(
    () => buildN2ObservationIngestReadiness(invalidLineageCount),
    /raw lineage complete snapshots exceed complete snapshots/,
  );

  const invalidCohort = baseInput();
  invalidCohort.cohort.dayCount = 32;
  assert.throws(() => buildN2ObservationIngestReadiness(invalidCohort), /invalid readiness cohort/);

  const duplicate = baseInput();
  duplicate.rollout.approvalScopes = [
    N2_OFFICIAL_PROGRAM_CANARY_APPROVAL,
    N2_OFFICIAL_PROGRAM_CANARY_APPROVAL,
  ];
  assert.throws(() => buildN2ObservationIngestReadiness(duplicate), /duplicate approval scope/);
});
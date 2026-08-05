export const N2_OBSERVATION_INGEST_READINESS_VERSION = "n2-observation-ingest-readiness-v1";

export const N2_OFFICIAL_PROGRAM_CANARY_APPROVAL = "N2_OFFICIAL_PROGRAM_OBSERVATION_CANARY";
export const N2_TRIFECTA_MARKET_CANARY_APPROVAL = "N2_TRIFECTA_MARKET_OBSERVATION_CANARY";

export type N2ObservationIngestReadinessInput = {
  cohort: {
    dateFrom: string;
    dateTo: string;
    dayCount: number;
  };
  primaryOfficialProgram: {
    totalRows: number;
    eligibleRows: number;
    missingRawJson: number;
    missingSourceFile: number;
    missingImportedAt: number;
    missingCloseAt: number;
  };
  primaryTrifectaMarket: {
    sourceTablePresent: boolean;
    totalRows: number;
    raceCount: number;
    validTimingRows: number;
    validSelectionRows: number;
    completeSnapshotCount: number;
    rawDocumentIdColumnPresent: boolean;
    rawPayloadColumnPresent: boolean;
    sourceUrlColumnPresent: boolean;
  };
  sidecar: {
    officialProgramObservationCount: number;
    trifectaMarketObservationCount: number;
    captureAttemptCount: number;
    outboxMessageCount: number;
    deliveryAttemptCount: number;
  };
  rollout: {
    shadowWriteEnabled: boolean;
    operationalGcEnabled: boolean;
    killSwitchEngaged: boolean;
    approvalScopes: string[];
  };
  wiring: {
    officialProgramCaptureImplemented: boolean;
    officialProgramProductionCallerConnected: boolean;
    trifectaMarketWriterImplemented: boolean;
  };
};

export type N2SourceIngestReadiness = {
  status: "READY_FOR_BOUNDED_CANARY" | "BLOCKED_NOT_READY";
  dataAvailable: boolean;
  currentObservationCount: number;
  blockers: string[];
};

export type N2ObservationIngestReadinessSummary = {
  readinessVersion: typeof N2_OBSERVATION_INGEST_READINESS_VERSION;
  cohort: N2ObservationIngestReadinessInput["cohort"];
  overallStatus: "READY_FOR_BOUNDED_CANARY" | "BLOCKED_NOT_READY_FOR_WRITE";
  writeAuthorized: false;
  autoEnableShadowWrite: false;
  recommendedCanaryMaxRaces: 20;
  officialProgram: N2SourceIngestReadiness & {
    sourceRows: number;
    eligibleRows: number;
    rawPayloadCoverage: number | null;
  };
  trifectaMarket: N2SourceIngestReadiness & {
    sourceRows: number;
    sourceRaceCount: number;
    completeSnapshotCount: number;
    rawLineageCapable: boolean;
  };
  rollout: N2ObservationIngestReadinessInput["rollout"];
  sidecar: N2ObservationIngestReadinessInput["sidecar"];
  nextActions: string[];
};

function assertCount(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
}

function validateInput(input: N2ObservationIngestReadinessInput): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.cohort.dateFrom)
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.cohort.dateTo)
    || input.cohort.dateFrom > input.cohort.dateTo
    || !Number.isInteger(input.cohort.dayCount)
    || input.cohort.dayCount < 1
    || input.cohort.dayCount > 31) {
    throw new Error("invalid readiness cohort");
  }
  for (const [field, value] of Object.entries({
    ...input.primaryOfficialProgram,
    totalRows: input.primaryOfficialProgram.totalRows,
    eligibleRows: input.primaryOfficialProgram.eligibleRows,
    officialProgramObservationCount: input.sidecar.officialProgramObservationCount,
    trifectaMarketObservationCount: input.sidecar.trifectaMarketObservationCount,
    captureAttemptCount: input.sidecar.captureAttemptCount,
    outboxMessageCount: input.sidecar.outboxMessageCount,
    deliveryAttemptCount: input.sidecar.deliveryAttemptCount,
    trifectaRows: input.primaryTrifectaMarket.totalRows,
    trifectaRaceCount: input.primaryTrifectaMarket.raceCount,
    validTimingRows: input.primaryTrifectaMarket.validTimingRows,
    validSelectionRows: input.primaryTrifectaMarket.validSelectionRows,
    completeSnapshotCount: input.primaryTrifectaMarket.completeSnapshotCount,
  })) {
    if (typeof value === "number") assertCount(value, field);
  }
  if (input.primaryOfficialProgram.eligibleRows > input.primaryOfficialProgram.totalRows) {
    throw new Error("official program eligible rows exceed total rows");
  }
  if (new Set(input.rollout.approvalScopes).size !== input.rollout.approvalScopes.length) {
    throw new Error("duplicate approval scope");
  }
}

function rolloutBlockers(input: N2ObservationIngestReadinessInput, approvalScope: string): string[] {
  const blockers: string[] = [];
  if (input.rollout.killSwitchEngaged) blockers.push("KILL_SWITCH_ENGAGED");
  if (!input.rollout.shadowWriteEnabled) blockers.push("SHADOW_WRITE_DISABLED");
  if (!input.rollout.approvalScopes.includes(approvalScope)) blockers.push(`APPROVAL_REQUIRED:${approvalScope}`);
  return blockers;
}

export function buildN2ObservationIngestReadiness(
  input: N2ObservationIngestReadinessInput,
): N2ObservationIngestReadinessSummary {
  validateInput(input);

  const officialBlockers = rolloutBlockers(input, N2_OFFICIAL_PROGRAM_CANARY_APPROVAL);
  if (input.primaryOfficialProgram.eligibleRows === 0) officialBlockers.push("OFFICIAL_PROGRAM_ELIGIBLE_SOURCE_EMPTY");
  if (!input.wiring.officialProgramCaptureImplemented) officialBlockers.push("OFFICIAL_PROGRAM_CAPTURE_NOT_IMPLEMENTED");
  if (!input.wiring.officialProgramProductionCallerConnected) officialBlockers.push("OFFICIAL_PROGRAM_PRODUCTION_CALLER_NOT_CONNECTED");

  const rawLineageCapable = input.primaryTrifectaMarket.rawDocumentIdColumnPresent
    && input.primaryTrifectaMarket.rawPayloadColumnPresent;
  const marketBlockers = rolloutBlockers(input, N2_TRIFECTA_MARKET_CANARY_APPROVAL);
  if (!input.primaryTrifectaMarket.sourceTablePresent || input.primaryTrifectaMarket.totalRows === 0) {
    marketBlockers.push("TRIFECTA_MARKET_SOURCE_EMPTY");
  }
  if (input.primaryTrifectaMarket.completeSnapshotCount === 0) marketBlockers.push("TRIFECTA_MARKET_COMPLETE_SNAPSHOT_EMPTY");
  if (!rawLineageCapable) marketBlockers.push("TRIFECTA_MARKET_RAW_LINEAGE_UNAVAILABLE");
  if (!input.wiring.trifectaMarketWriterImplemented) marketBlockers.push("TRIFECTA_MARKET_WRITER_NOT_IMPLEMENTED");

  const officialReady = officialBlockers.length === 0;
  const marketReady = marketBlockers.length === 0;
  const nextActions: string[] = [];
  if (!input.wiring.officialProgramProductionCallerConnected) {
    nextActions.push("Implement an approval-gated bounded official-program canary writer; do not enable global shadow writes.");
  }
  if (!rawLineageCapable) {
    nextActions.push("Capture live trifecta raw source documents before creating market observations; do not relabel aggregate primary rows as raw official evidence.");
  }
  if (!input.wiring.trifectaMarketWriterImplemented) {
    nextActions.push("Implement a trifecta-market raw capture and typed-observation writer with exact checkpoint and selection-space validation.");
  }
  if (!input.rollout.shadowWriteEnabled) {
    nextActions.push("Keep shadow_write_enabled=false until a source-specific canary approval and rollback plan exist.");
  }
  nextActions.push("Rerun TASK-N2-011 only after both official_program and trifecta_market observations are non-zero.");

  return {
    readinessVersion: N2_OBSERVATION_INGEST_READINESS_VERSION,
    cohort: input.cohort,
    overallStatus: officialReady && marketReady ? "READY_FOR_BOUNDED_CANARY" : "BLOCKED_NOT_READY_FOR_WRITE",
    writeAuthorized: false,
    autoEnableShadowWrite: false,
    recommendedCanaryMaxRaces: 20,
    officialProgram: {
      status: officialReady ? "READY_FOR_BOUNDED_CANARY" : "BLOCKED_NOT_READY",
      dataAvailable: input.primaryOfficialProgram.eligibleRows > 0,
      currentObservationCount: input.sidecar.officialProgramObservationCount,
      blockers: officialBlockers,
      sourceRows: input.primaryOfficialProgram.totalRows,
      eligibleRows: input.primaryOfficialProgram.eligibleRows,
      rawPayloadCoverage: input.primaryOfficialProgram.totalRows === 0
        ? null
        : (input.primaryOfficialProgram.totalRows - input.primaryOfficialProgram.missingRawJson)
          / input.primaryOfficialProgram.totalRows,
    },
    trifectaMarket: {
      status: marketReady ? "READY_FOR_BOUNDED_CANARY" : "BLOCKED_NOT_READY",
      dataAvailable: input.primaryTrifectaMarket.totalRows > 0,
      currentObservationCount: input.sidecar.trifectaMarketObservationCount,
      blockers: marketBlockers,
      sourceRows: input.primaryTrifectaMarket.totalRows,
      sourceRaceCount: input.primaryTrifectaMarket.raceCount,
      completeSnapshotCount: input.primaryTrifectaMarket.completeSnapshotCount,
      rawLineageCapable,
    },
    rollout: input.rollout,
    sidecar: input.sidecar,
    nextActions: [...new Set(nextActions)],
  };
}

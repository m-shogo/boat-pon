import { canonicalHash, canonicalUtcTimestamp } from "./canonical";

export const N2_TRIFECTA_MARKET_FOUNDATION_VERSION = "n2-trifecta-market-foundation-v1";
export const N2_TRIFECTA_MARKET_CANARY_MANIFEST_VERSION = "n2-trifecta-market-canary-manifest-v1";
export const N2_TRIFECTA_MARKET_REVIEW_BUNDLE_VERSION = "n2-trifecta-market-review-bundle-v1";
export const N2_TRIFECTA_MARKET_APPROVAL_SCOPE = "N2_TRIFECTA_MARKET_OBSERVATION_CANARY";
export const N2_TRIFECTA_SELECTION_COUNT = 120;
export const N2_TRIFECTA_CANARY_MAX_RACES = 20;

export type N2TrifectaMarketSourceInventory = {
  readerVersion: string;
  cohort: {
    dateFrom: string;
    dateTo: string;
    dayCount: number;
  };
  sourceTable: string | null;
  sourceTablePresent: boolean;
  columns: string[];
  totalRows: number;
  raceCount: number;
  checkpointCount: number;
  completeSnapshotCount: number;
  rawDocumentIdColumnPresent: boolean;
  rawPayloadColumnPresent: boolean;
  rawPayloadDigestColumnPresent: boolean;
  parseRunIdColumnPresent: boolean;
  sourceUrlColumnPresent: boolean;
  capturedAtColumnPresent: boolean;
  availableAtColumnPresent: boolean;
  decisionCutoffColumnPresent: boolean;
  checkpointLabelColumnPresent: boolean;
};

export type N2TrifectaOddsEntry = {
  selection: string;
  odds: number;
};

export type N2TrifectaMarketSnapshotCandidate = {
  raceId: string;
  checkpointLabel: string;
  capturedAt: string;
  availableAt: string;
  decisionCutoff: string;
  rawDocumentId: string;
  rawPayloadDigest: string;
  parseRunId: string;
  sourceUrl: string | null;
  proposedObservationId: string;
  odds: N2TrifectaOddsEntry[];
};

export type N2TrifectaSnapshotAudit = {
  raceId: string;
  checkpointIdentity: string | null;
  idempotencyKey: string | null;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  payload: {
    rowCount: number;
    distinctSelectionCount: number;
    expectedSelectionCount: typeof N2_TRIFECTA_SELECTION_COUNT;
    missingSelections: string[];
    extraSelections: string[];
    duplicateSelections: string[];
    invalidOddsSelections: string[];
  };
  pit: {
    status: "PASS" | "BLOCKED";
    availableAt: string;
    capturedAt: string;
    decisionCutoff: string;
    rule: "availableAt <= capturedAt <= decisionCutoff";
  };
  lineage: {
    status: "PASS" | "BLOCKED";
    rawDocumentId: string;
    rawPayloadDigest: string;
    parseRunId: string;
    proposedObservationId: string;
    sourceUrl: string | null;
  };
};

export type N2TrifectaMarketCanaryManifestEntry = {
  raceId: string;
  checkpointLabel: string;
  checkpointIdentity: string;
  idempotencyKey: string;
  capturedAt: string;
  availableAt: string;
  decisionCutoff: string;
  rawDocumentId: string;
  rawPayloadDigest: string;
  parseRunId: string;
  sourceUrl: string | null;
  proposedObservationId: string;
  selectionCount: typeof N2_TRIFECTA_SELECTION_COUNT;
};

export type N2TrifectaMarketCanaryManifest = {
  manifestVersion: typeof N2_TRIFECTA_MARKET_CANARY_MANIFEST_VERSION;
  sourceType: "trifecta_market";
  approvalScope: typeof N2_TRIFECTA_MARKET_APPROVAL_SCOPE;
  writeAuthorized: false;
  productionApplyExecuted: false;
  requestedMaxRaces: number;
  boundedMaxRaces: typeof N2_TRIFECTA_CANARY_MAX_RACES;
  entryCount: number;
  entries: N2TrifectaMarketCanaryManifestEntry[];
  manifestDigest: string;
};

export type N2TrifectaMarketFoundationSummary = {
  foundationVersion: typeof N2_TRIFECTA_MARKET_FOUNDATION_VERSION;
  status: "READY_FOR_HUMAN_REVIEW" | "BLOCKED_NOT_READY_FOR_CANARY";
  sourceType: "trifecta_market";
  writeAuthorized: false;
  autoCreateApproval: false;
  autoEnableShadowWrite: false;
  productionApplyExecuted: false;
  inventory: N2TrifectaMarketSourceInventory;
  inventoryBlockers: string[];
  candidateCount: number;
  safeCandidateCount: number;
  blockedCandidateCount: number;
  duplicateCheckpointIdentities: string[];
  candidateAudits: N2TrifectaSnapshotAudit[];
  canaryManifest: N2TrifectaMarketCanaryManifest;
  rollbackAndRevokeConditions: string[];
  idempotentReplayContract: {
    identityFields: string[];
    replayRule: "same identity and payload digest => reuse; identity collision with different digest => block";
    duplicateCheckpointRule: "duplicate checkpoint identity => block whole review bundle";
  };
  readOnlyVerificationContract: {
    primaryDbMode: "immutable/query-only";
    sidecarDbMode: "immutable/query-only";
    primaryDbWriteCount: 0;
    sidecarWriteCount: 0;
    requireNoActiveWal: true;
    requireManifestDigestMatch: true;
    requireObservationCountUnchanged: true;
    requireApprovalRevokedAfterApply: true;
  };
  reviewBundleDigest: string;
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function assertCount(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
}

function parseInstant(value: string): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    return Date.parse(canonicalUtcTimestamp(value));
  } catch {
    return null;
  }
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function isNonEmpty(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function isHttpUrl(value: string): boolean {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function isCanonicalCompactRaceDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const isoDate = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  try {
    return canonicalUtcTimestamp(`${isoDate}T00:00:00.000Z`).slice(0, 10) === isoDate;
  } catch {
    return false;
  }
}

function raceDateFromId(value: string): string | null {
  const match = /^(\d{8})-(0[1-9]|1\d|2[0-4])-(0[1-9]|1[0-2])$/.exec(value);
  if (!match || !isCanonicalCompactRaceDate(match[1])) return null;
  return `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`;
}

function isRaceId(value: string): boolean {
  return raceDateFromId(value) !== null;
}

function instantJstDate(value: number): string {
  return new Date(value + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function buildCanonicalTrifectaSelectionSpace(): string[] {
  const values: string[] = [];
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      if (second === first) continue;
      for (let third = 1; third <= 6; third += 1) {
        if (third === first || third === second) continue;
        values.push(`${first}${second}${third}`);
      }
    }
  }
  return values.sort();
}

const EXPECTED_SELECTIONS = buildCanonicalTrifectaSelectionSpace();
const EXPECTED_SELECTION_SET = new Set(EXPECTED_SELECTIONS);

export function buildN2TrifectaCheckpointIdentity(
  candidate: N2TrifectaMarketSnapshotCandidate,
): string | null {
  let capturedAt: string;
  try {
    capturedAt = canonicalUtcTimestamp(candidate.capturedAt);
  } catch {
    return null;
  }
  const identityInputValid = isRaceId(candidate.raceId)
    && isNonEmpty(candidate.checkpointLabel)
    && isNonEmpty(candidate.rawDocumentId);
  if (!identityInputValid) return null;
  return canonicalHash({
    sourceType: "trifecta_market",
    raceId: candidate.raceId,
    checkpointLabel: candidate.checkpointLabel,
    capturedAt,
    rawDocumentId: candidate.rawDocumentId,
  });
}

export function buildN2TrifectaIdempotencyKey(
  candidate: N2TrifectaMarketSnapshotCandidate,
  checkpointIdentity: string | null,
): string | null {
  const idempotencyInputValid = checkpointIdentity !== null
    && isSha256(candidate.rawPayloadDigest)
    && isNonEmpty(candidate.parseRunId)
    && isNonEmpty(candidate.proposedObservationId);
  if (!idempotencyInputValid) return null;
  return canonicalHash({
    checkpointIdentity,
    rawPayloadDigest: candidate.rawPayloadDigest,
    parseRunId: candidate.parseRunId,
    proposedObservationId: candidate.proposedObservationId,
  });
}

export function auditN2TrifectaMarketSnapshot(
  candidate: N2TrifectaMarketSnapshotCandidate,
): N2TrifectaSnapshotAudit {
  const blockers: string[] = [];
  const raceDate = raceDateFromId(candidate.raceId);
  if (!raceDate) blockers.push("RACE_ID_INVALID");
  if (!isNonEmpty(candidate.checkpointLabel)) blockers.push("CHECKPOINT_LABEL_MISSING");

  const availableAt = parseInstant(candidate.availableAt);
  const capturedAt = parseInstant(candidate.capturedAt);
  const decisionCutoff = parseInstant(candidate.decisionCutoff);
  if (availableAt === null) blockers.push("AVAILABLE_AT_INVALID");
  if (capturedAt === null) blockers.push("CAPTURED_AT_INVALID");
  if (decisionCutoff === null) blockers.push("DECISION_CUTOFF_INVALID");
  if (raceDate && availableAt !== null && instantJstDate(availableAt) !== raceDate) {
    blockers.push("AVAILABLE_AT_RACE_DATE_MISMATCH");
  }
  if (raceDate && capturedAt !== null && instantJstDate(capturedAt) !== raceDate) {
    blockers.push("CAPTURED_AT_RACE_DATE_MISMATCH");
  }
  if (raceDate && decisionCutoff !== null && instantJstDate(decisionCutoff) !== raceDate) {
    blockers.push("DECISION_CUTOFF_RACE_DATE_MISMATCH");
  }
  if (availableAt !== null && capturedAt !== null && availableAt > capturedAt) {
    blockers.push("AVAILABLE_AFTER_CAPTURE");
  }
  if (capturedAt !== null && decisionCutoff !== null && capturedAt > decisionCutoff) {
    blockers.push("CAPTURE_AFTER_DECISION_CUTOFF");
  }

  const counts = new Map<string, number>();
  const invalidOddsSelections: string[] = [];
  for (const entry of candidate.odds) {
    const selection = typeof entry.selection === "string" ? entry.selection.trim() : "";
    counts.set(selection, (counts.get(selection) ?? 0) + 1);
    if (!Number.isFinite(entry.odds) || entry.odds <= 0) invalidOddsSelections.push(selection);
  }
  const actual = new Set(counts.keys());
  const missingSelections = EXPECTED_SELECTIONS.filter((selection) => !actual.has(selection));
  const extraSelections = [...actual].filter((selection) => !EXPECTED_SELECTION_SET.has(selection)).sort();
  const duplicateSelections = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([selection]) => selection)
    .sort();
  if (candidate.odds.length !== N2_TRIFECTA_SELECTION_COUNT) blockers.push("PAYLOAD_ROW_COUNT_NOT_120");
  if (actual.size !== N2_TRIFECTA_SELECTION_COUNT) blockers.push("DISTINCT_SELECTION_COUNT_NOT_120");
  if (missingSelections.length > 0) blockers.push("SELECTION_SPACE_INCOMPLETE");
  if (extraSelections.length > 0) blockers.push("SELECTION_SPACE_INVALID");
  if (duplicateSelections.length > 0) blockers.push("DUPLICATE_SELECTION");
  if (invalidOddsSelections.length > 0) blockers.push("NON_POSITIVE_OR_NON_FINITE_ODDS");

  if (!isNonEmpty(candidate.rawDocumentId)) blockers.push("RAW_DOCUMENT_ID_MISSING");
  if (!isSha256(candidate.rawPayloadDigest)) blockers.push("RAW_PAYLOAD_DIGEST_INVALID");
  if (!isNonEmpty(candidate.parseRunId)) blockers.push("PARSE_RUN_ID_MISSING");
  if (!isNonEmpty(candidate.proposedObservationId)) blockers.push("PROPOSED_OBSERVATION_ID_MISSING");
  if (candidate.sourceUrl !== null && !isHttpUrl(candidate.sourceUrl)) blockers.push("SOURCE_URL_INVALID");

  const checkpointIdentity = buildN2TrifectaCheckpointIdentity(candidate);
  const idempotencyKey = buildN2TrifectaIdempotencyKey(candidate, checkpointIdentity);
  if (!checkpointIdentity) blockers.push("CHECKPOINT_IDENTITY_UNRESOLVED");
  if (!idempotencyKey) blockers.push("IDEMPOTENCY_KEY_UNRESOLVED");

  const uniqueBlockers = [...new Set(blockers)];
  const pitBlockers = uniqueBlockers.filter((blocker) => [
    "AVAILABLE_AT_INVALID",
    "CAPTURED_AT_INVALID",
    "DECISION_CUTOFF_INVALID",
    "AVAILABLE_AT_RACE_DATE_MISMATCH",
    "CAPTURED_AT_RACE_DATE_MISMATCH",
    "DECISION_CUTOFF_RACE_DATE_MISMATCH",
    "AVAILABLE_AFTER_CAPTURE",
    "CAPTURE_AFTER_DECISION_CUTOFF",
  ].includes(blocker));
  const lineageBlockers = uniqueBlockers.filter((blocker) => [
    "RAW_DOCUMENT_ID_MISSING",
    "RAW_PAYLOAD_DIGEST_INVALID",
    "PARSE_RUN_ID_MISSING",
    "PROPOSED_OBSERVATION_ID_MISSING",
    "SOURCE_URL_INVALID",
  ].includes(blocker));

  return {
    raceId: candidate.raceId,
    checkpointIdentity,
    idempotencyKey,
    status: uniqueBlockers.length === 0 ? "PASS" : "BLOCKED",
    blockers: uniqueBlockers,
    payload: {
      rowCount: candidate.odds.length,
      distinctSelectionCount: actual.size,
      expectedSelectionCount: N2_TRIFECTA_SELECTION_COUNT,
      missingSelections,
      extraSelections,
      duplicateSelections,
      invalidOddsSelections: [...new Set(invalidOddsSelections)].sort(),
    },
    pit: {
      status: pitBlockers.length === 0 ? "PASS" : "BLOCKED",
      availableAt: candidate.availableAt,
      capturedAt: candidate.capturedAt,
      decisionCutoff: candidate.decisionCutoff,
      rule: "availableAt <= capturedAt <= decisionCutoff",
    },
    lineage: {
      status: lineageBlockers.length === 0 ? "PASS" : "BLOCKED",
      rawDocumentId: candidate.rawDocumentId,
      rawPayloadDigest: candidate.rawPayloadDigest,
      parseRunId: candidate.parseRunId,
      proposedObservationId: candidate.proposedObservationId,
      sourceUrl: candidate.sourceUrl,
    },
  };
}

function validateInventory(inventory: N2TrifectaMarketSourceInventory): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inventory.cohort.dateFrom)
    || !/^\d{4}-\d{2}-\d{2}$/.test(inventory.cohort.dateTo)
    || inventory.cohort.dateFrom > inventory.cohort.dateTo
    || !Number.isInteger(inventory.cohort.dayCount)
    || inventory.cohort.dayCount < 1
    || inventory.cohort.dayCount > 31) {
    throw new Error("invalid trifecta market inventory cohort");
  }
  for (const [field, value] of Object.entries({
    totalRows: inventory.totalRows,
    raceCount: inventory.raceCount,
    checkpointCount: inventory.checkpointCount,
    completeSnapshotCount: inventory.completeSnapshotCount,
  })) assertCount(value, field);
  if (new Set(inventory.columns).size !== inventory.columns.length) throw new Error("duplicate inventory columns");
  if (inventory.sourceTablePresent !== Boolean(inventory.sourceTable)) throw new Error("source table presence mismatch");
}

function inventoryBlockers(inventory: N2TrifectaMarketSourceInventory): string[] {
  const blockers: string[] = [];
  if (!inventory.sourceTablePresent || !inventory.sourceTable) blockers.push("SOURCE_TABLE_MISSING");
  if (inventory.totalRows === 0) blockers.push("SOURCE_ROWS_EMPTY");
  if (inventory.raceCount === 0) blockers.push("SOURCE_RACES_EMPTY");
  if (inventory.checkpointCount === 0) blockers.push("CHECKPOINTS_EMPTY");
  if (inventory.completeSnapshotCount === 0) blockers.push("COMPLETE_120_SELECTION_SNAPSHOT_EMPTY");
  if (!inventory.rawDocumentIdColumnPresent) blockers.push("RAW_DOCUMENT_ID_COLUMN_MISSING");
  if (!inventory.rawPayloadColumnPresent) blockers.push("RAW_PAYLOAD_COLUMN_MISSING");
  if (!inventory.rawPayloadDigestColumnPresent) blockers.push("RAW_PAYLOAD_DIGEST_COLUMN_MISSING");
  if (!inventory.parseRunIdColumnPresent) blockers.push("PARSE_RUN_ID_COLUMN_MISSING");
  if (!inventory.capturedAtColumnPresent) blockers.push("CAPTURED_AT_COLUMN_MISSING");
  if (!inventory.availableAtColumnPresent) blockers.push("AVAILABLE_AT_COLUMN_MISSING");
  if (!inventory.decisionCutoffColumnPresent) blockers.push("DECISION_CUTOFF_COLUMN_MISSING");
  if (!inventory.checkpointLabelColumnPresent) blockers.push("CHECKPOINT_LABEL_COLUMN_MISSING");
  return blockers;
}

export function buildN2TrifectaMarketFoundation(input: {
  inventory: N2TrifectaMarketSourceInventory;
  candidates: N2TrifectaMarketSnapshotCandidate[];
  requestedMaxRaces?: number;
}): N2TrifectaMarketFoundationSummary {
  validateInventory(input.inventory);
  const requestedMaxRaces = input.requestedMaxRaces ?? N2_TRIFECTA_CANARY_MAX_RACES;
  if (!Number.isInteger(requestedMaxRaces) || requestedMaxRaces < 1 || requestedMaxRaces > N2_TRIFECTA_CANARY_MAX_RACES) {
    throw new Error(`requestedMaxRaces must be 1..${N2_TRIFECTA_CANARY_MAX_RACES}`);
  }

  const candidateAuditPairs = input.candidates
    .map((candidate) => ({ candidate, audit: auditN2TrifectaMarketSnapshot(candidate) }))
    .sort((left, right) => {
      const identity = (left.audit.checkpointIdentity ?? "").localeCompare(right.audit.checkpointIdentity ?? "");
      if (identity !== 0) return identity;
      const race = left.candidate.raceId.localeCompare(right.candidate.raceId);
      if (race !== 0) return race;
      const checkpoint = left.candidate.checkpointLabel.localeCompare(right.candidate.checkpointLabel);
      if (checkpoint !== 0) return checkpoint;
      const captured = left.candidate.capturedAt.localeCompare(right.candidate.capturedAt);
      if (captured !== 0) return captured;
      return left.candidate.proposedObservationId.localeCompare(right.candidate.proposedObservationId);
    });
  const audits = candidateAuditPairs.map(({ audit }) => audit);
  const identities = new Map<string, number>();
  for (const audit of audits) {
    if (audit.checkpointIdentity) identities.set(audit.checkpointIdentity, (identities.get(audit.checkpointIdentity) ?? 0) + 1);
  }
  const duplicateCheckpointIdentities = [...identities.entries()]
    .filter(([, count]) => count > 1)
    .map(([identity]) => identity)
    .sort();

  const sourceBlockers = inventoryBlockers(input.inventory);
  const safePairs = candidateAuditPairs.filter(({ audit }) => audit.status === "PASS");

  const globallyBlocked = sourceBlockers.length > 0 || duplicateCheckpointIdentities.length > 0;
  const selected = globallyBlocked ? [] : safePairs.slice(0, requestedMaxRaces);
  const entries: N2TrifectaMarketCanaryManifestEntry[] = selected.map(({ candidate, audit }) => ({
    raceId: candidate.raceId,
    checkpointLabel: candidate.checkpointLabel,
    checkpointIdentity: audit.checkpointIdentity!,
    idempotencyKey: audit.idempotencyKey!,
    capturedAt: candidate.capturedAt,
    availableAt: candidate.availableAt,
    decisionCutoff: candidate.decisionCutoff,
    rawDocumentId: candidate.rawDocumentId,
    rawPayloadDigest: candidate.rawPayloadDigest,
    parseRunId: candidate.parseRunId,
    sourceUrl: candidate.sourceUrl,
    proposedObservationId: candidate.proposedObservationId,
    selectionCount: N2_TRIFECTA_SELECTION_COUNT,
  }));
  const manifestCore: Omit<N2TrifectaMarketCanaryManifest, "manifestDigest"> = {
    manifestVersion: N2_TRIFECTA_MARKET_CANARY_MANIFEST_VERSION as typeof N2_TRIFECTA_MARKET_CANARY_MANIFEST_VERSION,
    sourceType: "trifecta_market" as const,
    approvalScope: N2_TRIFECTA_MARKET_APPROVAL_SCOPE,
    writeAuthorized: false as const,
    productionApplyExecuted: false as const,
    requestedMaxRaces,
    boundedMaxRaces: N2_TRIFECTA_CANARY_MAX_RACES,
    entryCount: entries.length,
    entries,
  };
  const canaryManifest: N2TrifectaMarketCanaryManifest = {
    ...manifestCore,
    manifestDigest: canonicalHash(manifestCore),
  };

  const status = sourceBlockers.length === 0
    && duplicateCheckpointIdentities.length === 0
    && entries.length > 0
    ? "READY_FOR_HUMAN_REVIEW" as const
    : "BLOCKED_NOT_READY_FOR_CANARY" as const;
  const reviewCore: Omit<N2TrifectaMarketFoundationSummary, "reviewBundleDigest"> = {
    foundationVersion: N2_TRIFECTA_MARKET_FOUNDATION_VERSION as typeof N2_TRIFECTA_MARKET_FOUNDATION_VERSION,
    status,
    sourceType: "trifecta_market" as const,
    writeAuthorized: false as const,
    autoCreateApproval: false as const,
    autoEnableShadowWrite: false as const,
    productionApplyExecuted: false as const,
    inventory: input.inventory,
    inventoryBlockers: sourceBlockers,
    candidateCount: input.candidates.length,
    safeCandidateCount: safePairs.length,
    blockedCandidateCount: audits.filter((audit) => audit.status === "BLOCKED").length,
    duplicateCheckpointIdentities,
    candidateAudits: audits,
    canaryManifest,
    rollbackAndRevokeConditions: [
      "active WAL or mutable DB access detected",
      "manifest digest, source schema, raw payload digest, or checkpoint identity drift",
      "missing or expired source-specific approval",
      "any availableAt/capturedAt/decisionCutoff PIT ordering violation",
      "incomplete or duplicate 120-selection payload",
      "raw document, parse run, or proposed observation lineage mismatch",
      "insert/reuse/write counts differ from reviewed manifest",
      "primary DB write count is non-zero",
      "sidecar writes occur outside the approved bounded canary transaction",
      "idempotent replay changes observation identity or payload digest",
      "post-apply read-only verification fails",
    ],
    idempotentReplayContract: {
      identityFields: [
        "raceId",
        "checkpointLabel",
        "capturedAt",
        "rawDocumentId",
        "rawPayloadDigest",
        "parseRunId",
        "proposedObservationId",
      ],
      replayRule: "same identity and payload digest => reuse; identity collision with different digest => block" as const,
      duplicateCheckpointRule: "duplicate checkpoint identity => block whole review bundle" as const,
    },
    readOnlyVerificationContract: {
      primaryDbMode: "immutable/query-only" as const,
      sidecarDbMode: "immutable/query-only" as const,
      primaryDbWriteCount: 0 as const,
      sidecarWriteCount: 0 as const,
      requireNoActiveWal: true as const,
      requireManifestDigestMatch: true as const,
      requireObservationCountUnchanged: true as const,
      requireApprovalRevokedAfterApply: true as const,
    },
  };

  return {
    ...reviewCore,
    reviewBundleDigest: canonicalHash(reviewCore),
  };
}

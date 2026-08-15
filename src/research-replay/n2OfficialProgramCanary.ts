import type { DatabaseSync } from "node:sqlite";
import { officialVenueCode } from "../domain/officialLinks";
import { resolveApproval, type ApprovalMode, type ApprovalResolution } from "./approval";
import { canonicalHash, canonicalUtcTimestamp, sha256Bytes } from "./canonical";
import { canonicalRaceKey } from "./identity";
import {
  buildOfficialProgramObservationEnvelope,
  N2_OFFICIAL_PROGRAM_PARSER_VERSION,
  N2_OFFICIAL_PROGRAM_SOURCE_SCHEMA_VERSION,
} from "./n2OfficialProgramObservation";
import type { ResearchReplayRepository } from "./repository";
import {
  APPROVAL_CONTRACT_VERSION,
  ROLLOUT_SCHEMA_VERSION,
  SIDECAR_SCHEMA_VERSION,
} from "./schema";

export const N2_OFFICIAL_PROGRAM_CANARY_MANIFEST_VERSION = "n2-official-program-canary-manifest-v1";
export const N2_OFFICIAL_PROGRAM_CANARY_SELECTION_POLICY_VERSION = "n2-official-program-canary-selection-v1";
export const N2_OFFICIAL_PROGRAM_CANARY_CONTRACT_PREFIX = "n2-official-program-observation-canary-v1";
export const N2_OFFICIAL_PROGRAM_CANARY_GATE_VERSION = "n2-official-program-canary-gate-v1";
export const N2_OFFICIAL_PROGRAM_CANARY_APPROVAL_SCOPE = "N2_OFFICIAL_PROGRAM_OBSERVATION_CANARY";
export const N2_OFFICIAL_PROGRAM_CANARY_TARGET_STAGE = "N2-OFFICIAL-PROGRAM-CANARY";
export const N2_OFFICIAL_PROGRAM_CANARY_MAX_RACES = 20;

export type OfficialProgramCanaryCohort = { dateFrom: string; dateTo: string };
export type OfficialProgramCanarySourceRow = {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  closeAt: string;
  sourceFile: string;
  rawJson: string;
  importedAt: string;
};
export type OfficialProgramCanaryManifestItem = {
  primaryRecordId: string;
  primaryIdentityEncoding: "venue_label" | "venue_code";
  canonicalRaceKey: string;
  date: string;
  venueCode: string;
  raceNo: number;
  decisionCutoff: string;
  sourceObservedAt: string;
  rawSha256: string;
  sourceReferenceSha256: string;
};
export type OfficialProgramCanaryExclusion = { primaryRecordId: string; reason: string };
export type OfficialProgramCanaryManifestBinding = {
  manifestVersion: typeof N2_OFFICIAL_PROGRAM_CANARY_MANIFEST_VERSION;
  selectionPolicyVersion: typeof N2_OFFICIAL_PROGRAM_CANARY_SELECTION_POLICY_VERSION;
  primaryTable: "official_programs";
  cohort: OfficialProgramCanaryCohort;
  sourceRowCount: number;
  eligibleRowCount: number;
  excludedCount: number;
  excludedDigest: string;
  maxRaces: number;
  codeGitSha: string;
  items: OfficialProgramCanaryManifestItem[];
};
export type OfficialProgramCanaryManifest = {
  manifestVersion: typeof N2_OFFICIAL_PROGRAM_CANARY_MANIFEST_VERSION;
  generatedAt: string;
  binding: OfficialProgramCanaryManifestBinding;
  manifestDigest: string;
  excluded: OfficialProgramCanaryExclusion[];
};
export type OfficialProgramCanaryGateInput = {
  manifest: OfficialProgramCanaryManifest;
  executionMode: ApprovalMode;
  rolloutStartedAt: string;
  approvalGrantId?: string | null;
  onDisk: {
    codeGitSha: string | null;
    hasActiveWal: boolean;
    diskFreeBytes: number;
    neededBytes: number;
    shadowWriteEnabled: boolean;
    killSwitchEngaged: boolean;
  };
};
export type OfficialProgramCanaryGateResult = {
  gateVersion: typeof N2_OFFICIAL_PROGRAM_CANARY_GATE_VERSION;
  approved: boolean;
  status: "PASS" | "BLOCKED";
  exitCode: 0 | 3;
  blocks: string[];
  approval: ApprovalResolution;
  manifestDigest: string;
  recomputedManifestDigest: string;
};
export type OfficialProgramCanaryApplyResult = {
  gateVersion: typeof N2_OFFICIAL_PROGRAM_CANARY_GATE_VERSION;
  approvalId: string;
  manifestDigest: string;
  selectedCount: number;
  insertedCount: number;
  reusedCount: number;
  primaryWriteCount: 0;
  sidecarWriteAuthorized: true;
  globalShadowWriteEnabled: false;
};

type CachedCaptureResult = { observationId: string; reusedObservation: boolean };

function validGitSha(value: string): boolean {
  return /^[a-f0-9]{7,40}$/.test(value);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function assertCohort(cohort: OfficialProgramCanaryCohort): void {
  if (!validDate(cohort.dateFrom) || !validDate(cohort.dateTo) || cohort.dateFrom > cohort.dateTo) {
    throw new Error("INVALID_CANARY_COHORT");
  }
}

function canonicalDatabaseTimestamp(value: string): string {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  return canonicalUtcTimestamp(normalized);
}

function isCanonicalUtcTimestamp(value: string): boolean {
  try {
    return canonicalUtcTimestamp(value) === value;
  } catch {
    return false;
  }
}

function closeAtUtc(date: string, closeAt: string): string {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(closeAt);
  if (match === null) throw new Error("INVALID_CLOSE_AT");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) throw new Error("INVALID_CLOSE_AT");
  const time = `${match[1]}:${match[2]}:${match[3] ?? "00"}`;
  const parsed = Date.parse(`${date}T${time}+09:00`);
  if (!Number.isFinite(parsed)) throw new Error("INVALID_CLOSE_AT");
  return new Date(parsed).toISOString();
}

function primaryIdentityEncoding(
  row: OfficialProgramCanarySourceRow,
  venueCode: string,
): "venue_label" | "venue_code" {
  const suffix = String(row.raceNo).padStart(2, "0");
  const compactDate = row.date.replaceAll("-", "");
  const venueToken = row.venue.trim();
  const labelIdentity = `${compactDate}-${venueToken}-${suffix}`;
  const codeIdentity = `${compactDate}-${venueCode}-${suffix}`;
  if (row.raceId === labelIdentity) return venueToken === venueCode ? "venue_code" : "venue_label";
  if (row.raceId === codeIdentity) return "venue_code";
  throw new Error("RACE_IDENTITY_MISMATCH");
}

function normalizeSourceRow(
  row: OfficialProgramCanarySourceRow,
  cohort: OfficialProgramCanaryCohort,
): OfficialProgramCanaryManifestItem {
  if (!validDate(row.date)) throw new Error("INVALID_RACE_DATE");
  if (row.date < cohort.dateFrom || row.date > cohort.dateTo) throw new Error("OUTSIDE_COHORT");
  if (!Number.isInteger(row.raceNo) || row.raceNo < 1 || row.raceNo > 12) throw new Error("INVALID_RACE_NO");
  const venueCode = officialVenueCode(row.venue);
  if (venueCode === null) throw new Error("UNKNOWN_VENUE");
  const encoding = primaryIdentityEncoding(row, venueCode);
  if (row.sourceFile.trim() === "") throw new Error("SOURCE_REFERENCE_MISSING");
  if (row.rawJson.trim() === "") throw new Error("RAW_JSON_MISSING");

  const sourceObservedAt = canonicalDatabaseTimestamp(row.importedAt);
  const decisionCutoff = closeAtUtc(row.date, row.closeAt);
  if (Date.parse(sourceObservedAt) >= Date.parse(decisionCutoff)) throw new Error("POST_CUTOFF_PRIMARY_IMPORT");
  const key = canonicalRaceKey(row.date, venueCode, row.raceNo);
  buildOfficialProgramObservationEnvelope({
    canonicalRaceKey: key,
    rawJson: row.rawJson,
    sourcePublishedAt: null,
    sourceObservedAt,
    firstSeenAt: sourceObservedAt,
  });
  return {
    primaryRecordId: row.raceId,
    primaryIdentityEncoding: encoding,
    canonicalRaceKey: key,
    date: row.date,
    venueCode,
    raceNo: row.raceNo,
    decisionCutoff,
    sourceObservedAt,
    rawSha256: sha256Bytes(Buffer.from(row.rawJson, "utf8")),
    sourceReferenceSha256: sha256Bytes(Buffer.from(row.sourceFile, "utf8")),
  };
}

export function buildOfficialProgramCanaryManifest(input: {
  rows: OfficialProgramCanarySourceRow[];
  cohort: OfficialProgramCanaryCohort;
  sourceReadTruncated?: boolean;
  maxRaces?: number;
  codeGitSha: string;
  generatedAt: string;
}): OfficialProgramCanaryManifest {
  assertCohort(input.cohort);
  if (input.sourceReadTruncated === true) throw new Error("CANARY_SOURCE_READ_TRUNCATED");
  const maxRaces = input.maxRaces ?? N2_OFFICIAL_PROGRAM_CANARY_MAX_RACES;
  if (!Number.isInteger(maxRaces) || maxRaces < 1 || maxRaces > N2_OFFICIAL_PROGRAM_CANARY_MAX_RACES) {
    throw new Error("INVALID_CANARY_MAX_RACES");
  }
  if (!validGitSha(input.codeGitSha)) throw new Error("INVALID_CODE_GIT_SHA");
  const generatedAt = canonicalUtcTimestamp(input.generatedAt);
  const included: OfficialProgramCanaryManifestItem[] = [];
  const excluded: OfficialProgramCanaryExclusion[] = [];
  const seenRaceIds = new Set<string>();
  for (const row of [...input.rows].sort((left, right) => left.raceId.localeCompare(right.raceId, "en"))) {
    if (seenRaceIds.has(row.raceId)) throw new Error(`DUPLICATE_PRIMARY_RACE:${row.raceId}`);
    seenRaceIds.add(row.raceId);
    try {
      included.push(normalizeSourceRow(row, input.cohort));
    } catch (error) {
      excluded.push({
        primaryRecordId: row.raceId,
        reason: error instanceof Error ? error.message : "UNKNOWN_SOURCE_ROW_ERROR",
      });
    }
  }
  const items = included.slice(0, maxRaces);
  const binding: OfficialProgramCanaryManifestBinding = {
    manifestVersion: N2_OFFICIAL_PROGRAM_CANARY_MANIFEST_VERSION,
    selectionPolicyVersion: N2_OFFICIAL_PROGRAM_CANARY_SELECTION_POLICY_VERSION,
    primaryTable: "official_programs",
    cohort: { ...input.cohort },
    sourceRowCount: input.rows.length,
    eligibleRowCount: included.length,
    excludedCount: excluded.length,
    excludedDigest: canonicalHash(excluded),
    maxRaces,
    codeGitSha: input.codeGitSha,
    items,
  };
  return {
    manifestVersion: N2_OFFICIAL_PROGRAM_CANARY_MANIFEST_VERSION,
    generatedAt,
    binding,
    manifestDigest: canonicalHash(binding),
    excluded,
  };
}

export function assertOfficialProgramCanaryManifest(manifest: OfficialProgramCanaryManifest): void {
  if (manifest.manifestVersion !== N2_OFFICIAL_PROGRAM_CANARY_MANIFEST_VERSION
    || manifest.binding.manifestVersion !== N2_OFFICIAL_PROGRAM_CANARY_MANIFEST_VERSION
    || manifest.binding.selectionPolicyVersion !== N2_OFFICIAL_PROGRAM_CANARY_SELECTION_POLICY_VERSION
    || manifest.binding.primaryTable !== "official_programs") {
    throw new Error("CANARY_MANIFEST_VERSION_MISMATCH");
  }
  assertCohort(manifest.binding.cohort);
  if (!Number.isSafeInteger(manifest.binding.sourceRowCount)
    || !Number.isSafeInteger(manifest.binding.eligibleRowCount)
    || !Number.isSafeInteger(manifest.binding.excludedCount)
    || manifest.binding.sourceRowCount < 0
    || manifest.binding.eligibleRowCount < manifest.binding.items.length
    || manifest.binding.excludedCount !== manifest.excluded.length
    || manifest.binding.sourceRowCount !== manifest.binding.eligibleRowCount + manifest.binding.excludedCount) {
    throw new Error("CANARY_MANIFEST_COUNT_MISMATCH");
  }
  if (manifest.binding.excludedDigest !== canonicalHash(manifest.excluded)) {
    throw new Error("CANARY_MANIFEST_EXCLUSION_DIGEST_MISMATCH");
  }
  if (!Number.isInteger(manifest.binding.maxRaces)
    || manifest.binding.maxRaces < 1
    || manifest.binding.maxRaces > N2_OFFICIAL_PROGRAM_CANARY_MAX_RACES
    || manifest.binding.items.length > manifest.binding.maxRaces) {
    throw new Error("CANARY_MANIFEST_BOUND_INVALID");
  }
  if (!validGitSha(manifest.binding.codeGitSha)) throw new Error("CANARY_MANIFEST_CODE_SHA_INVALID");
  canonicalUtcTimestamp(manifest.generatedAt);
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const item of manifest.binding.items) {
    if (keys.has(item.canonicalRaceKey) || ids.has(item.primaryRecordId)) throw new Error("CANARY_MANIFEST_DUPLICATE_ITEM");
    keys.add(item.canonicalRaceKey);
    ids.add(item.primaryRecordId);
    if (!/^[a-f0-9]{64}$/.test(item.rawSha256)
      || !/^[a-f0-9]{64}$/.test(item.sourceReferenceSha256)
      || !["venue_label", "venue_code"].includes(item.primaryIdentityEncoding)
      || item.date < manifest.binding.cohort.dateFrom
      || item.date > manifest.binding.cohort.dateTo
      || item.canonicalRaceKey !== canonicalRaceKey(item.date, item.venueCode, item.raceNo)
      || !isCanonicalUtcTimestamp(item.sourceObservedAt)
      || !isCanonicalUtcTimestamp(item.decisionCutoff)
      || Date.parse(item.sourceObservedAt) >= Date.parse(item.decisionCutoff)) {
      throw new Error("CANARY_MANIFEST_ITEM_INVALID");
    }
  }
  if (manifest.manifestDigest !== canonicalHash(manifest.binding)) throw new Error("CANARY_MANIFEST_DIGEST_MISMATCH");
}

export function officialProgramCanaryApprovalTarget(manifestDigest: string) {
  if (!/^[a-f0-9]{64}$/.test(manifestDigest)) throw new Error("INVALID_CANARY_MANIFEST_DIGEST");
  return {
    approvalScope: N2_OFFICIAL_PROGRAM_CANARY_APPROVAL_SCOPE,
    targetStage: N2_OFFICIAL_PROGRAM_CANARY_TARGET_STAGE,
    targetSchemaVersion: `${ROLLOUT_SCHEMA_VERSION}@${SIDECAR_SCHEMA_VERSION}`,
    targetContractVersion: `${N2_OFFICIAL_PROGRAM_CANARY_CONTRACT_PREFIX}:${manifestDigest}:${APPROVAL_CONTRACT_VERSION}`,
  } as const;
}

function approvalTargetForGate(manifestDigest: string) {
  return /^[a-f0-9]{64}$/.test(manifestDigest)
    ? officialProgramCanaryApprovalTarget(manifestDigest)
    : {
      approvalScope: N2_OFFICIAL_PROGRAM_CANARY_APPROVAL_SCOPE,
      targetStage: N2_OFFICIAL_PROGRAM_CANARY_TARGET_STAGE,
      targetSchemaVersion: `${ROLLOUT_SCHEMA_VERSION}@${SIDECAR_SCHEMA_VERSION}`,
      targetContractVersion: "invalid-canary-manifest-digest",
    } as const;
}

export function resolveOfficialProgramCanaryGate(
  db: DatabaseSync,
  input: OfficialProgramCanaryGateInput,
): OfficialProgramCanaryGateResult {
  const blocks: string[] = [];
  let recomputedManifestDigest = "invalid";
  try {
    assertOfficialProgramCanaryManifest(input.manifest);
    recomputedManifestDigest = canonicalHash(input.manifest.binding);
  } catch (error) {
    blocks.push(error instanceof Error ? error.message : "CANARY_MANIFEST_INVALID");
  }
  if (input.manifest.binding.items.length === 0) blocks.push("CANARY_COHORT_EMPTY");
  if (input.executionMode !== "production") blocks.push("MODE_NOT_PRODUCTION");
  if (input.onDisk.hasActiveWal) blocks.push("ACTIVE_WAL");
  if (!Number.isSafeInteger(input.onDisk.diskFreeBytes)
    || !Number.isSafeInteger(input.onDisk.neededBytes)
    || input.onDisk.neededBytes < 0
    || input.onDisk.diskFreeBytes < input.onDisk.neededBytes) blocks.push("INSUFFICIENT_DISK");
  if (input.onDisk.shadowWriteEnabled) blocks.push("GLOBAL_SHADOW_WRITE_MUST_REMAIN_DISABLED");
  if (input.onDisk.killSwitchEngaged) blocks.push("KILL_SWITCH_ENGAGED");
  if (input.onDisk.codeGitSha === null || input.onDisk.codeGitSha !== input.manifest.binding.codeGitSha) blocks.push("CODE_SHA_MISMATCH");

  const approval = resolveApproval(db, {
    ...approvalTargetForGate(input.manifest.manifestDigest),
    rolloutStartedAt: input.rolloutStartedAt,
    executionMode: input.executionMode,
  });
  if (!approval.approved) blocks.push(`APPROVAL_${approval.code}`);
  if (input.approvalGrantId && approval.approvalId !== input.approvalGrantId) blocks.push("APPROVAL_GRANT_ID_MISMATCH");
  const approved = blocks.length === 0 && approval.approved;
  return {
    gateVersion: N2_OFFICIAL_PROGRAM_CANARY_GATE_VERSION,
    approved,
    status: approved ? "PASS" : "BLOCKED",
    exitCode: approved ? 0 : 3,
    blocks,
    approval,
    manifestDigest: input.manifest.manifestDigest,
    recomputedManifestDigest,
  };
}

function sourceRowMap(rows: OfficialProgramCanarySourceRow[]): Map<string, OfficialProgramCanarySourceRow> {
  const map = new Map<string, OfficialProgramCanarySourceRow>();
  for (const row of rows) {
    if (map.has(row.raceId)) throw new Error(`DUPLICATE_PRIMARY_RACE:${row.raceId}`);
    map.set(row.raceId, row);
  }
  return map;
}

export function verifyOfficialProgramCanaryPrimaryRows(
  manifest: OfficialProgramCanaryManifest,
  rows: OfficialProgramCanarySourceRow[],
): Map<string, OfficialProgramCanarySourceRow> {
  assertOfficialProgramCanaryManifest(manifest);
  const map = sourceRowMap(rows);
  for (const item of manifest.binding.items) {
    const row = map.get(item.primaryRecordId);
    if (!row) throw new Error(`PRIMARY_ROW_MISSING:${item.primaryRecordId}`);
    if (canonicalHash(normalizeSourceRow(row, manifest.binding.cohort)) !== canonicalHash(item)) {
      throw new Error(`PRIMARY_ROW_DRIFT:${item.primaryRecordId}`);
    }
  }
  return map;
}

function captureCachedOfficialProgram(input: {
  repository: ResearchReplayRepository;
  manifestDigest: string;
  item: OfficialProgramCanaryManifestItem;
  row: OfficialProgramCanarySourceRow;
}): CachedCaptureResult {
  const timestamp = input.item.sourceObservedAt;
  const captureAttemptId = input.repository.createCaptureAttempt({
    logicalRequestGroupId: `n2-official-program-canary:${input.manifestDigest}`,
    canonicalRaceKey: input.item.canonicalRaceKey,
    sourceUrl: `primary-cache://official_programs/${encodeURIComponent(input.item.primaryRecordId)}`,
    method: "EXISTING_CACHE",
    requestStartedAt: timestamp,
    sourceType: "official_program",
  });
  input.repository.addCaptureEvent({ captureAttemptId, eventKind: "capture_started", occurredAt: timestamp });
  const raw = input.repository.recordRawDocument({
    bytes: Buffer.from(input.row.rawJson, "utf8"),
    contentType: "application/json",
    charset: "utf-8",
    retentionClass: "research_evidence",
  });
  const bodyCompletedEventId = input.repository.addCaptureEvent({
    captureAttemptId,
    eventKind: "body_completed",
    occurredAt: timestamp,
    byteCount: Buffer.byteLength(input.row.rawJson, "utf8"),
  });
  input.repository.linkCaptureToRaw({ captureAttemptId, rawDocumentId: raw.rawDocumentId, bodyCompletedEventId, linkedAt: timestamp });
  const reusable = raw.deduplicated
    ? input.repository.findReusableTypedObservation({
      rawDocumentId: raw.rawDocumentId,
      canonicalRaceKey: input.item.canonicalRaceKey,
      parserName: "n2-official-program",
      parserVersion: N2_OFFICIAL_PROGRAM_PARSER_VERSION,
      sourceSchemaVersion: N2_OFFICIAL_PROGRAM_SOURCE_SCHEMA_VERSION,
      payloadType: "official_program",
    })
    : null;
  const parse = reusable ?? input.repository.parseTypedRawDocument({
    rawDocumentId: raw.rawDocumentId,
    parserName: "n2-official-program",
    parserVersion: N2_OFFICIAL_PROGRAM_PARSER_VERSION,
    expectedSourceSchemaVersion: N2_OFFICIAL_PROGRAM_SOURCE_SCHEMA_VERSION,
    parse: (bytes) => buildOfficialProgramObservationEnvelope({
      canonicalRaceKey: input.item.canonicalRaceKey,
      rawJson: bytes.toString("utf8"),
      sourcePublishedAt: null,
      sourceObservedAt: timestamp,
      firstSeenAt: timestamp,
    }),
  });
  if (!parse.observationId || (parse.status !== "success" && parse.status !== "warning")) {
    throw new Error(`CANARY_PARSE_FAILED:${input.item.primaryRecordId}`);
  }
  return { observationId: parse.observationId, reusedObservation: reusable !== null };
}

export function applyOfficialProgramCanary(input: {
  db: DatabaseSync;
  repository: ResearchReplayRepository;
  manifest: OfficialProgramCanaryManifest;
  primaryRows: OfficialProgramCanarySourceRow[];
  gateInput: Omit<OfficialProgramCanaryGateInput, "manifest">;
}): OfficialProgramCanaryApplyResult {
  const gate = resolveOfficialProgramCanaryGate(input.db, { manifest: input.manifest, ...input.gateInput });
  if (!gate.approved || gate.recomputedManifestDigest !== input.manifest.manifestDigest) {
    throw new Error(`CANARY_GATE_NOT_APPROVED:${gate.blocks.join(",")}`);
  }
  if (!gate.approval.approvalId) throw new Error("CANARY_APPROVAL_ID_MISSING");
  const rows = verifyOfficialProgramCanaryPrimaryRows(input.manifest, input.primaryRows);
  let insertedCount = 0;
  let reusedCount = 0;
  for (const item of input.manifest.binding.items) {
    const existing = Number((input.db.prepare(`
      SELECT COUNT(*) n
      FROM domain_observations o
      JOIN raw_documents r ON r.raw_document_id=o.raw_document_id
      WHERE o.canonical_race_key=? AND o.observation_type='official_program' AND r.raw_sha256=?
    `).get(item.canonicalRaceKey, item.rawSha256) as { n: number }).n);
    if (existing > 1) throw new Error(`AMBIGUOUS_EXISTING_OBSERVATION:${item.primaryRecordId}`);
    if (existing === 1) {
      reusedCount += 1;
      continue;
    }
    const capture = captureCachedOfficialProgram({
      repository: input.repository,
      manifestDigest: input.manifest.manifestDigest,
      item,
      row: rows.get(item.primaryRecordId)!,
    });
    if (capture.reusedObservation) reusedCount += 1;
    else insertedCount += 1;
  }
  return {
    gateVersion: gate.gateVersion,
    approvalId: gate.approval.approvalId,
    manifestDigest: input.manifest.manifestDigest,
    selectedCount: input.manifest.binding.items.length,
    insertedCount,
    reusedCount,
    primaryWriteCount: 0,
    sidecarWriteAuthorized: true,
    globalShadowWriteEnabled: false,
  };
}

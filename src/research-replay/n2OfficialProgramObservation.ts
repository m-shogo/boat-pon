import {
  PAYLOAD_SCHEMA_VERSION,
  semanticPayloadHash,
  validateTypedPayload,
  type OfficialProgramBoatPayload,
  type OfficialProgramPayload,
} from "./domain";
import { canonicalUtcTimestamp } from "./canonical";
import type { ParseResult, ResearchReplayRepository } from "./repository";

export const N2_OFFICIAL_PROGRAM_SOURCE_SCHEMA_VERSION = "official-program-primary-raw-v1";
export const N2_OFFICIAL_PROGRAM_PARSER_VERSION = "n2-official-program-parser-v1";

type JsonRecord = Record<string, unknown>;

export type OfficialProgramObservationEnvelope = {
  sourceSchemaVersion: typeof N2_OFFICIAL_PROGRAM_SOURCE_SCHEMA_VERSION;
  payloadType: "official_program";
  canonicalRaceKey: string;
  payload: OfficialProgramPayload;
  sourcePublishedAt: string | null;
  sourceObservedAt: string;
  firstSeenAt: string;
  timingQuality: "source_exact" | "observed_only";
  sourceQuality: "official_public";
  measurementQuality: "official_program_raw";
  effectiveAt: string | null;
};

export type OfficialProgramTypedPayloadRow = {
  domainPayloadType: string | null;
  domainPayloadSchemaVersion: string | null;
  domainSemanticPayloadHash: string | null;
  typedPayloadType: string | null;
  typedPayloadSchemaVersion: string | null;
  typedPayloadJson: string | null;
  typedPayloadHash: string | null;
};

export type OfficialProgramPayloadVerification =
  | { status: "verified"; payload: OfficialProgramPayload }
  | { status: "excluded"; reason: string };

export type OfficialProgramIngestResult = {
  rawDocumentId: string;
  rawSha256: string;
  relativePath: string;
  parse: ParseResult;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function nullableRate(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(`invalid official program ${field}`);
  return number;
}

function normalizeBoat(value: unknown): OfficialProgramBoatPayload {
  if (!isRecord(value)) throw new Error("invalid official program boat");
  const course = typeof value.course === "number" ? value.course : Number(value.course);
  if (!Number.isInteger(course)) throw new Error("invalid official program course");
  return {
    course,
    registrationNo: nullableText(value.registrationNo),
    className: nullableText(value.className) as OfficialProgramBoatPayload["className"],
    nationalWinRate: nullableRate(value.nationalWinRate, "nationalWinRate"),
    nationalTop2Rate: nullableRate(value.nationalTop2Rate, "nationalTop2Rate"),
    localWinRate: nullableRate(value.localWinRate, "localWinRate"),
    localTop2Rate: nullableRate(value.localTop2Rate, "localTop2Rate"),
    motorTop2Rate: nullableRate(value.motorTop2Rate, "motorTop2Rate"),
    boatTop2Rate: nullableRate(value.boatTop2Rate, "boatTop2Rate"),
  };
}

export function buildOfficialProgramPayload(input: {
  canonicalRaceKey: string;
  observedAt: string;
  rawJson: string;
}): OfficialProgramPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(input.rawJson) as unknown;
  } catch {
    throw new Error("invalid official program raw JSON");
  }
  if (!isRecord(raw) || !Array.isArray(raw.boats)) throw new Error("official program boats missing");
  const payload: OfficialProgramPayload = {
    canonicalRaceKey: input.canonicalRaceKey,
    observedAt: canonicalUtcTimestamp(input.observedAt),
    boats: raw.boats.map(normalizeBoat).sort((a, b) => a.course - b.course),
  };
  return validateTypedPayload("official_program", payload) as OfficialProgramPayload;
}

export function buildOfficialProgramObservationEnvelope(input: {
  canonicalRaceKey: string;
  rawJson: string;
  sourcePublishedAt: string | null;
  sourceObservedAt: string;
  firstSeenAt: string;
}): OfficialProgramObservationEnvelope {
  const sourcePublishedAt = input.sourcePublishedAt === null
    ? null
    : canonicalUtcTimestamp(input.sourcePublishedAt);
  const sourceObservedAt = canonicalUtcTimestamp(input.sourceObservedAt);
  const firstSeenAt = canonicalUtcTimestamp(input.firstSeenAt);
  if (sourcePublishedAt !== null && Date.parse(sourcePublishedAt) > Date.parse(sourceObservedAt)) {
    throw new Error("official program published after observation");
  }
  if (Date.parse(sourceObservedAt) > Date.parse(firstSeenAt)) {
    throw new Error("official program observed after first seen");
  }
  return {
    sourceSchemaVersion: N2_OFFICIAL_PROGRAM_SOURCE_SCHEMA_VERSION,
    payloadType: "official_program",
    canonicalRaceKey: input.canonicalRaceKey,
    payload: buildOfficialProgramPayload({
      canonicalRaceKey: input.canonicalRaceKey,
      observedAt: sourceObservedAt,
      rawJson: input.rawJson,
    }),
    sourcePublishedAt,
    sourceObservedAt,
    firstSeenAt,
    timingQuality: sourcePublishedAt === null ? "observed_only" : "source_exact",
    sourceQuality: "official_public",
    measurementQuality: "official_program_raw",
    effectiveAt: sourcePublishedAt,
  };
}

export function ingestOfficialProgramObservation(input: {
  repository: ResearchReplayRepository;
  rawJson: string;
  canonicalRaceKey: string;
  sourcePublishedAt: string | null;
  sourceObservedAt: string;
  firstSeenAt: string;
  rawDocumentId?: string;
  parseRunId?: string;
  observationId?: string;
}): OfficialProgramIngestResult {
  const raw = input.repository.recordRawDocument({
    rawDocumentId: input.rawDocumentId,
    bytes: Buffer.from(input.rawJson, "utf8"),
    contentType: "application/json",
    charset: "utf-8",
    retentionClass: "research_evidence",
  });
  const parse = input.repository.parseTypedRawDocument({
    rawDocumentId: raw.rawDocumentId,
    parseRunId: input.parseRunId,
    observationId: input.observationId,
    parserName: "n2-official-program",
    parserVersion: N2_OFFICIAL_PROGRAM_PARSER_VERSION,
    expectedSourceSchemaVersion: N2_OFFICIAL_PROGRAM_SOURCE_SCHEMA_VERSION,
    parse: (bytes) => buildOfficialProgramObservationEnvelope({
      canonicalRaceKey: input.canonicalRaceKey,
      rawJson: bytes.toString("utf8"),
      sourcePublishedAt: input.sourcePublishedAt,
      sourceObservedAt: input.sourceObservedAt,
      firstSeenAt: input.firstSeenAt,
    }),
  });
  return {
    rawDocumentId: raw.rawDocumentId,
    rawSha256: raw.rawSha256,
    relativePath: raw.relativePath,
    parse,
  };
}

export function verifyOfficialProgramTypedPayload(input: {
  canonicalRaceKey: string;
  sourceObservedAt: string;
  primaryRawJson: string;
  row: OfficialProgramTypedPayloadRow;
}): OfficialProgramPayloadVerification {
  const row = input.row;
  if (row.typedPayloadJson === null) return { status: "excluded", reason: "excluded_program_typed_payload_missing" };
  if (row.domainPayloadType !== "official_program" || row.typedPayloadType !== "official_program") {
    return { status: "excluded", reason: "excluded_program_typed_payload_type_mismatch" };
  }
  if (row.domainPayloadSchemaVersion !== PAYLOAD_SCHEMA_VERSION
    || row.typedPayloadSchemaVersion !== PAYLOAD_SCHEMA_VERSION) {
    return { status: "excluded", reason: "excluded_program_typed_payload_schema_mismatch" };
  }
  let typedPayload: OfficialProgramPayload;
  try {
    typedPayload = validateTypedPayload(
      "official_program",
      JSON.parse(row.typedPayloadJson) as unknown,
    ) as OfficialProgramPayload;
  } catch {
    return { status: "excluded", reason: "excluded_program_typed_payload_invalid" };
  }
  const typedHash = semanticPayloadHash("official_program", typedPayload);
  if (row.typedPayloadHash !== typedHash || row.domainSemanticPayloadHash !== typedHash) {
    return { status: "excluded", reason: "excluded_program_typed_payload_hash_mismatch" };
  }
  if (typedPayload.canonicalRaceKey !== input.canonicalRaceKey
    || Date.parse(typedPayload.observedAt) !== Date.parse(input.sourceObservedAt)) {
    return { status: "excluded", reason: "excluded_program_typed_payload_identity_mismatch" };
  }
  let primaryPayload: OfficialProgramPayload;
  try {
    primaryPayload = buildOfficialProgramPayload({
      canonicalRaceKey: input.canonicalRaceKey,
      observedAt: input.sourceObservedAt,
      rawJson: input.primaryRawJson,
    });
  } catch {
    return { status: "excluded", reason: "excluded_program_primary_payload_invalid" };
  }
  if (semanticPayloadHash("official_program", primaryPayload) !== typedHash) {
    return { status: "excluded", reason: "excluded_program_primary_payload_mismatch" };
  }
  return { status: "verified", payload: typedPayload };
}

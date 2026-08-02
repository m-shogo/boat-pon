import { sha256Bytes, canonicalUtcTimestamp } from "./canonical";
import {
  captureOfficialProgramObservation,
  buildOfficialProgramObservationEnvelope,
  type OfficialProgramCaptureResult,
} from "./n2OfficialProgramObservation";
import { allowlistedHeaders, redactSourceUrl } from "./rawStore";
import {
  PermanentShadowDeliveryError,
  RolloutController,
  type EnqueueResult,
} from "./rollout";
import type { ResearchReplayRepository } from "./repository";

export const N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE = "n2.official_program.capture.v1";
export const N2_OFFICIAL_PROGRAM_SHADOW_PAYLOAD_VERSION = "n2-official-program-shadow-v1";

export type OfficialProgramShadowInput = {
  primaryRecordId: string;
  logicalRequestGroupId: string;
  canonicalRaceKey: string;
  sourceUrl: string;
  requestStartedAt: string;
  responseHeadersReceivedAt: string;
  bodyCompletedAt: string;
  sourcePublishedAt: string | null;
  sourceObservedAt: string;
  firstSeenAt: string;
  rawJson: string;
  httpStatus: number;
  responseHeaders?: Record<string, string>;
};

export type OfficialProgramShadowPayload = Omit<OfficialProgramShadowInput, "rawJson" | "responseHeaders"> & {
  version: typeof N2_OFFICIAL_PROGRAM_SHADOW_PAYLOAD_VERSION;
  expectedRawSha256: string;
  responseHeaders: Record<string, string>;
};

export type PrimaryRawLoader = (primaryRecordId: string) => string | null;

export class OfficialProgramShadowEnqueueError extends Error {
  constructor(readonly enqueueStatus: EnqueueResult["status"]) {
    super(`official program shadow enqueue rejected: ${enqueueStatus}`);
    this.name = "OFFICIAL_PROGRAM_SHADOW_ENQUEUE_REJECTED";
  }
}

export class OfficialProgramShadowSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OFFICIAL_PROGRAM_SHADOW_SOURCE_INVALID";
  }
}

class OfficialProgramShadowPayloadError extends PermanentShadowDeliveryError {
  constructor(message: string) {
    super("OFFICIAL_PROGRAM_SHADOW_PAYLOAD_INVALID", message);
  }
}

function canonicalizeInput(input: OfficialProgramShadowInput): OfficialProgramShadowPayload {
  if (input.primaryRecordId.trim() === "" || input.logicalRequestGroupId.trim() === "") {
    throw new Error("official program shadow source identity missing");
  }
  const requestStartedAt = canonicalUtcTimestamp(input.requestStartedAt);
  const responseHeadersReceivedAt = canonicalUtcTimestamp(input.responseHeadersReceivedAt);
  const bodyCompletedAt = canonicalUtcTimestamp(input.bodyCompletedAt);
  const sourceObservedAt = canonicalUtcTimestamp(input.sourceObservedAt);
  const firstSeenAt = canonicalUtcTimestamp(input.firstSeenAt);
  const sourcePublishedAt = input.sourcePublishedAt === null
    ? null
    : canonicalUtcTimestamp(input.sourcePublishedAt);
  if (Date.parse(responseHeadersReceivedAt) < Date.parse(requestStartedAt)
    || Date.parse(bodyCompletedAt) < Date.parse(responseHeadersReceivedAt)) {
    throw new Error("official program shadow capture time order invalid");
  }
  if (bodyCompletedAt !== sourceObservedAt) {
    throw new Error("official program shadow observation must equal completed body time");
  }
  if (!Number.isInteger(input.httpStatus) || input.httpStatus < 100 || input.httpStatus > 599) {
    throw new Error("official program shadow HTTP status invalid");
  }
  buildOfficialProgramObservationEnvelope({
    canonicalRaceKey: input.canonicalRaceKey,
    rawJson: input.rawJson,
    sourcePublishedAt,
    sourceObservedAt,
    firstSeenAt,
  });
  return {
    version: N2_OFFICIAL_PROGRAM_SHADOW_PAYLOAD_VERSION,
    primaryRecordId: input.primaryRecordId,
    logicalRequestGroupId: input.logicalRequestGroupId,
    canonicalRaceKey: input.canonicalRaceKey,
    sourceUrl: redactSourceUrl(input.sourceUrl),
    requestStartedAt,
    responseHeadersReceivedAt,
    bodyCompletedAt,
    sourcePublishedAt,
    sourceObservedAt,
    firstSeenAt,
    expectedRawSha256: sha256Bytes(Buffer.from(input.rawJson, "utf8")),
    httpStatus: input.httpStatus,
    responseHeaders: allowlistedHeaders(input.responseHeaders ?? {}),
  };
}

function idempotencyKey(payload: OfficialProgramShadowPayload): string {
  return [
    N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE,
    payload.canonicalRaceKey,
    payload.requestStartedAt,
    payload.expectedRawSha256,
  ].join(":");
}

export function enqueueOfficialProgramShadow(
  controller: RolloutController,
  input: OfficialProgramShadowInput,
): EnqueueResult {
  const payload = canonicalizeInput(input);
  return controller.enqueue({
    idempotencyKey: idempotencyKey(payload),
    messageType: N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE,
    payload,
  });
}

function decodePayload(value: unknown): OfficialProgramShadowPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OfficialProgramShadowPayloadError("official program shadow payload must be an object");
  }
  const record = value as Record<string, unknown>;
  const expected = [
    "bodyCompletedAt", "canonicalRaceKey", "expectedRawSha256", "firstSeenAt", "httpStatus",
    "logicalRequestGroupId", "primaryRecordId", "requestStartedAt", "responseHeaders",
    "responseHeadersReceivedAt", "sourceObservedAt", "sourcePublishedAt", "sourceUrl", "version",
  ].sort();
  const actual = Object.keys(record).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new OfficialProgramShadowPayloadError("official program shadow payload fields invalid");
  }
  const textFields = [
    "primaryRecordId", "logicalRequestGroupId", "canonicalRaceKey", "sourceUrl", "requestStartedAt",
    "responseHeadersReceivedAt", "bodyCompletedAt", "sourceObservedAt", "firstSeenAt", "expectedRawSha256",
  ] as const;
  for (const field of textFields) {
    if (typeof record[field] !== "string" || (record[field] as string).trim() === "") {
      throw new OfficialProgramShadowPayloadError(`official program shadow ${field} invalid`);
    }
  }
  if (record.version !== N2_OFFICIAL_PROGRAM_SHADOW_PAYLOAD_VERSION
    || (record.sourcePublishedAt !== null && typeof record.sourcePublishedAt !== "string")
    || !Number.isInteger(record.httpStatus)
    || typeof record.responseHeaders !== "object"
    || record.responseHeaders === null
    || Array.isArray(record.responseHeaders)) {
    throw new OfficialProgramShadowPayloadError("official program shadow payload contract mismatch");
  }
  const payload = record as OfficialProgramShadowPayload;
  if (!/^[a-f0-9]{64}$/.test(payload.expectedRawSha256)
    || redactSourceUrl(payload.sourceUrl) !== payload.sourceUrl) {
    throw new OfficialProgramShadowPayloadError("official program shadow reference integrity invalid");
  }
  const headers = payload.responseHeaders;
  if (Object.values(headers).some((value) => typeof value !== "string")
    || JSON.stringify(allowlistedHeaders(headers)) !== JSON.stringify(headers)) {
    throw new OfficialProgramShadowPayloadError("official program shadow headers invalid");
  }
  return payload;
}

export function handleOfficialProgramShadowMessage(input: {
  repository: ResearchReplayRepository;
  messageType: string;
  payload: unknown;
  loadPrimaryRaw: PrimaryRawLoader;
}): OfficialProgramCaptureResult {
  if (input.messageType !== N2_OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE) {
    throw new PermanentShadowDeliveryError(
      "OFFICIAL_PROGRAM_SHADOW_MESSAGE_TYPE_UNSUPPORTED",
      "unsupported official program shadow message type",
    );
  }
  const payload = decodePayload(input.payload);
  const rawJson = input.loadPrimaryRaw(payload.primaryRecordId);
  if (rawJson === null) throw new OfficialProgramShadowSourceError("primary official program row missing");
  const actualHash = sha256Bytes(Buffer.from(rawJson, "utf8"));
  if (actualHash !== payload.expectedRawSha256) {
    throw new OfficialProgramShadowSourceError("primary official program raw hash mismatch");
  }
  return captureOfficialProgramObservation({
    repository: input.repository,
    logicalRequestGroupId: payload.logicalRequestGroupId,
    canonicalRaceKey: payload.canonicalRaceKey,
    sourceUrl: payload.sourceUrl,
    requestStartedAt: payload.requestStartedAt,
    responseHeadersReceivedAt: payload.responseHeadersReceivedAt,
    bodyCompletedAt: payload.bodyCompletedAt,
    sourcePublishedAt: payload.sourcePublishedAt,
    sourceObservedAt: payload.sourceObservedAt,
    firstSeenAt: payload.firstSeenAt,
    rawJson,
    httpStatus: payload.httpStatus,
    responseHeaders: payload.responseHeaders,
  });
}

export function runPrimaryWithOfficialProgramShadow<T>(input: {
  controller: RolloutController;
  primary: () => T;
  shadowInput: (primaryResult: T) => OfficialProgramShadowInput;
}) {
  let primaryResult: T;
  return input.controller.runPrimaryWithOptionalShadow(
    () => {
      primaryResult = input.primary();
      return primaryResult;
    },
    () => {
      const result = enqueueOfficialProgramShadow(input.controller, input.shadowInput(primaryResult));
      if (result.status !== "enqueued" && result.status !== "existing") {
        throw new OfficialProgramShadowEnqueueError(result.status);
      }
    },
  );
}

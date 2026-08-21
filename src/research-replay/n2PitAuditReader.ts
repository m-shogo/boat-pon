import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { officialVenueCode } from "../domain/officialLinks";
import { canonicalUtcTimestamp } from "./canonical";
import { canonicalRaceKey } from "./identity";
import { freezeCheckpoint, PAYLOAD_SCHEMA_VERSION, semanticPayloadHash, validateTypedPayload } from "./domain";
import type { N2PitAuditObservation } from "./n2PitAudit";

export const N2_PIT_AUDIT_READER_VERSION = "n2-pit-audit-reader-v2";
export const N2_PIT_AUDIT_MAX_OBSERVATIONS = 100_000;

export type N2PitAuditReadResult = {
  observations: N2PitAuditObservation[];
  returnedObservationCount: number;
  truncated: boolean;
  readOnly: true;
  queryOnly: true;
  sourceTypes: readonly ["official_program", "trifecta_market"];
};

type SourceObservationRow = Omit<N2PitAuditObservation, "decisionCutoff" | "typedPayloadIntegrity"> & {
  observationPayloadType: string | null;
  observationPayloadSchemaVersion: string | null;
  observationPayloadHash: string | null;
  typedPayloadType: string | null;
  typedPayloadSchemaVersion: string | null;
  typedPayloadHash: string | null;
  typedPayloadJson: string | null;
};
type ProgramCutoffRow = {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  closeAt: string | null;
};
type CanonicalN2Key = {
  date: string;
  compactDate: string;
  venueCode: string;
  raceNo: number;
};

const FEATURE_OBSERVATION_SQL = `
SELECT
  o.observation_id AS observationId,
  o.canonical_race_key AS canonicalRaceKey,
  o.observation_type AS observationType,
  o.raw_document_id AS observationRawDocumentId,
  o.source_published_at AS sourcePublishedAt,
  o.source_observed_at AS sourceObservedAt,
  o.first_seen_at AS firstSeenAt,
  o.timing_quality AS timingQuality,
  o.source_quality AS sourceQuality,
  o.payload_type AS observationPayloadType,
  o.payload_schema_version AS observationPayloadSchemaVersion,
  o.semantic_payload_hash AS observationPayloadHash,
  p.raw_document_id AS parseRawDocumentId,
  p.status AS parseStatus,
  r.raw_document_id AS rawDocumentId,
  r.integrity_status AS integrityStatus,
  r.security_scan_status AS securityScanStatus,
  r.parser_replay_eligible AS parserReplayEligible,
  t.payload_type AS typedPayloadType,
  t.payload_schema_version AS typedPayloadSchemaVersion,
  t.payload_hash AS typedPayloadHash,
  t.payload_json AS typedPayloadJson
FROM domain_observations o
JOIN parse_runs p ON p.parse_run_id = o.parse_run_id
JOIN raw_documents r ON r.raw_document_id = o.raw_document_id
LEFT JOIN typed_observation_payloads t ON t.observation_id = o.observation_id
WHERE o.observation_type IN ('official_program', 'trifecta_market')
ORDER BY
  substr(o.canonical_race_key, 1, 10),
  substr(o.canonical_race_key, 12, 2),
  CAST(substr(o.canonical_race_key, instr(o.canonical_race_key, ':R') + 2) AS INTEGER),
  o.observation_type,
  o.observation_id
LIMIT ?
`;

function openImmutable(path: string): DatabaseSync {
  const db = new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, { readOnly: true } as never);
  db.exec("PRAGMA query_only = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

function parseCanonicalN2Key(canonicalRaceKeyValue: string): CanonicalN2Key | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}):(0[1-9]|1\d|2[0-4]):R(\d{1,2})$/.exec(canonicalRaceKeyValue);
  if (!match) return null;
  const raceNo = Number(match[5]);
  if (!Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  try {
    canonicalRaceKey(date, match[4], raceNo);
  } catch {
    return null;
  }
  return {
    date,
    compactDate: `${match[1]}${match[2]}${match[3]}`,
    venueCode: match[4],
    raceNo,
  };
}

export function raceIdFromCanonicalN2Key(canonicalRaceKeyValue: string): string | null {
  const parsed = parseCanonicalN2Key(canonicalRaceKeyValue);
  return parsed === null
    ? null
    : `${parsed.compactDate}-${parsed.venueCode}-${String(parsed.raceNo).padStart(2, "0")}`;
}

export function programIdentityMatchesCanonicalKey(
  row: ProgramCutoffRow | null,
  expectedCanonicalRaceKey: string,
): boolean {
  if (row === null) return false;
  const parsed = parseCanonicalN2Key(expectedCanonicalRaceKey);
  if (parsed === null
    || row.date !== parsed.date
    || !Number.isInteger(row.raceNo)
    || row.raceNo !== parsed.raceNo) {
    return false;
  }
  const normalizedVenue = row.venue.trim();
  if (officialVenueCode(normalizedVenue) !== parsed.venueCode) return false;
  const raceSuffix = String(parsed.raceNo).padStart(2, "0");
  const acceptedRaceIds = new Set([
    `${parsed.compactDate}-${parsed.venueCode}-${raceSuffix}`,
    `${parsed.compactDate}-${normalizedVenue}-${raceSuffix}`,
  ]);
  return acceptedRaceIds.has(row.raceId);
}

export function decisionCutoffFromProgram(row: ProgramCutoffRow | null, expectedCanonicalRaceKey: string): string | null {
  if (row === null || !programIdentityMatchesCanonicalKey(row, expectedCanonicalRaceKey) || row.closeAt === null) {
    return null;
  }
  const close = row.closeAt.trim();
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(close);
  if (!timeMatch) return null;
  const time = `${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3] ?? "00"}`;
  const parsed = Date.parse(`${row.date}T${time}+09:00`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function canonicalInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return canonicalUtcTimestamp(value);
  } catch {
    return null;
  }
}

function hasValidCheckpointSemantics(payload: Record<string, unknown>): boolean {
  try {
    const expected = freezeCheckpoint(
      String(payload.scheduledCloseAtSeen),
      String(payload.observedAt),
    );
    return canonicalInstant(payload.scheduledCloseAtSeen) === expected.scheduledCloseAtSeen
      && canonicalInstant(payload.observedAt) === expected.observedAt
      && payload.minutesBeforeCloseAtCapture === expected.minutesBeforeCloseAtCapture
      && payload.checkpointLabelAtCapture === expected.checkpointLabelAtCapture
      && payload.checkpointPolicyVersion === expected.checkpointPolicyVersion;
  } catch {
    return false;
  }
}

function typedPayloadIntegrity(row: SourceObservationRow): "verified" | "invalid" {
  if ((row.observationType !== "official_program" && row.observationType !== "trifecta_market")
    || row.observationPayloadType !== row.observationType
    || row.typedPayloadType !== row.observationType
    || row.observationPayloadSchemaVersion !== PAYLOAD_SCHEMA_VERSION
    || row.typedPayloadSchemaVersion !== PAYLOAD_SCHEMA_VERSION
    || row.observationPayloadHash === null
    || row.typedPayloadHash === null
    || row.observationPayloadHash !== row.typedPayloadHash
    || row.typedPayloadJson === null) {
    return "invalid";
  }
  try {
    const payload = validateTypedPayload(
      row.observationType,
      JSON.parse(row.typedPayloadJson) as unknown,
    ) as Record<string, unknown>;
    const semanticHash = semanticPayloadHash(row.observationType, payload);
    if (semanticHash !== row.observationPayloadHash || semanticHash !== row.typedPayloadHash) return "invalid";
    if (row.observationType === "official_program" && payload.canonicalRaceKey !== row.canonicalRaceKey) return "invalid";
    if (row.observationType === "trifecta_market" && !hasValidCheckpointSemantics(payload)) return "invalid";
    const payloadObservedAt = canonicalInstant(payload.observedAt);
    const sourceObservedAt = canonicalInstant(row.sourceObservedAt);
    if (payloadObservedAt === null || sourceObservedAt === null || payloadObservedAt !== sourceObservedAt) return "invalid";
    return "verified";
  } catch {
    return "invalid";
  }
}

function assertCanonicalSourceTimestamps(row: SourceObservationRow): void {
  if (canonicalInstant(row.sourceObservedAt) === null
    || canonicalInstant(row.firstSeenAt) === null
    || (row.sourcePublishedAt !== null && canonicalInstant(row.sourcePublishedAt) === null)) {
    throw new Error(`N2_PIT_AUDIT_INVALID_SOURCE_TIMESTAMP:${row.observationId}`);
  }
}

export function readN2PitAuditObservations(input: {
  primaryDbPath: string;
  sidecarDbPath: string;
  limit?: number;
}): N2PitAuditReadResult {
  const limit = input.limit ?? N2_PIT_AUDIT_MAX_OBSERVATIONS;
  if (!Number.isInteger(limit) || limit < 1 || limit > N2_PIT_AUDIT_MAX_OBSERVATIONS) {
    throw new Error(`N2_PIT_AUDIT_INVALID_LIMIT:${limit}`);
  }

  const primary = openImmutable(input.primaryDbPath);
  const sidecar = openImmutable(input.sidecarDbPath);
  try {
    const sourceRows = sidecar.prepare(FEATURE_OBSERVATION_SQL).all(limit + 1) as unknown as SourceObservationRow[];
    for (const row of sourceRows) {
      if (parseCanonicalN2Key(row.canonicalRaceKey) === null) {
        throw new Error(`N2_PIT_AUDIT_INVALID_RACE_KEY:${row.canonicalRaceKey}`);
      }
      assertCanonicalSourceTimestamps(row);
    }
    const truncated = sourceRows.length > limit;
    const boundedRows = truncated ? sourceRows.slice(0, limit) : sourceRows;
    const programCandidates = primary.prepare(`
      SELECT race_id AS raceId, date, venue, race_no AS raceNo, close_at AS closeAt
      FROM official_programs
      WHERE date = ? AND race_no = ?
      ORDER BY race_id
    `);
    const cutoffCache = new Map<string, string | null>();
    const observations = boundedRows.map((row): N2PitAuditObservation => {
      let cutoff = cutoffCache.get(row.canonicalRaceKey);
      if (cutoff === undefined) {
        const parsed = parseCanonicalN2Key(row.canonicalRaceKey);
        const candidates = parsed === null
          ? []
          : programCandidates.all(parsed.date, parsed.raceNo) as unknown as ProgramCutoffRow[];
        const matchingRows = candidates.filter((candidate) =>
          programIdentityMatchesCanonicalKey(candidate, row.canonicalRaceKey));
        cutoff = matchingRows.length === 1
          ? decisionCutoffFromProgram(matchingRows[0], row.canonicalRaceKey)
          : null;
        cutoffCache.set(row.canonicalRaceKey, cutoff);
      }
      const {
        observationPayloadType: _observationPayloadType,
        observationPayloadSchemaVersion: _observationPayloadSchemaVersion,
        observationPayloadHash: _observationPayloadHash,
        typedPayloadType: _typedPayloadType,
        typedPayloadSchemaVersion: _typedPayloadSchemaVersion,
        typedPayloadHash: _typedPayloadHash,
        typedPayloadJson: _typedPayloadJson,
        ...evidence
      } = row;
      return {
        ...evidence,
        typedPayloadIntegrity: typedPayloadIntegrity(row),
        decisionCutoff: cutoff,
      };
    });
    return {
      observations,
      returnedObservationCount: observations.length,
      truncated,
      readOnly: true,
      queryOnly: true,
      sourceTypes: ["official_program", "trifecta_market"],
    };
  } finally {
    sidecar.close();
    primary.close();
  }
}
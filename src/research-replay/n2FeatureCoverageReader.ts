import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import type { N2FeatureCoverageEvent } from "./n2FeatureCoverage";
import {
  verifyN2FeatureLineage,
  type N2FeatureLineageEvidenceRow,
} from "./n2FeatureLineage";
import {
  adaptOfficialProgramFeatures,
  N2_OFFICIAL_PROGRAM_FEATURE_KEYS,
  type OfficialProgramSourceRow,
} from "./n2FeatureSourceAdapter";
import { PAYLOAD_SCHEMA_VERSION } from "./domain";
import {
  verifyOfficialProgramTypedPayload,
  type OfficialProgramTypedPayloadRow,
} from "./n2OfficialProgramObservation";

export const N2_FEATURE_COVERAGE_READER_VERSION = "n2-feature-coverage-reader-v1";

export type N2CoverageRaceRow = {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  sourceFile: string;
  rawJson: string;
  importedAt: string;
};

type N2CoverageRaceIdentityRow = Pick<N2CoverageRaceRow, "raceId" | "date" | "venue" | "raceNo">;
type ProgramLineageRow = N2FeatureLineageEvidenceRow & Pick<
  OfficialProgramTypedPayloadRow,
  "domainPayloadType" | "domainPayloadSchemaVersion" | "domainSemanticPayloadHash"
>;
type ProgramTypedPayloadRow = Pick<
  OfficialProgramTypedPayloadRow,
  "typedPayloadType" | "typedPayloadSchemaVersion" | "typedPayloadJson" | "typedPayloadHash"
>;

const PROGRAM_LINEAGE_SQL = `
SELECT
  o.observation_id AS observationId,
  o.canonical_race_key AS canonicalRaceKey,
  o.observation_type AS observationType,
  o.payload_type AS domainPayloadType,
  o.payload_schema_version AS domainPayloadSchemaVersion,
  o.semantic_payload_hash AS domainSemanticPayloadHash,
  o.raw_document_id AS observationRawDocumentId,
  o.source_published_at AS sourcePublishedAt,
  o.source_observed_at AS sourceObservedAt,
  o.first_seen_at AS firstSeenAt,
  o.timing_quality AS timingQuality,
  o.source_quality AS sourceQuality,
  p.raw_document_id AS parseRawDocumentId,
  p.status AS parseStatus,
  r.raw_document_id AS rawDocumentId,
  r.integrity_status AS integrityStatus,
  r.security_scan_status AS securityScanStatus,
  r.parser_replay_eligible AS parserReplayEligible
FROM domain_observations o
JOIN parse_runs p ON p.parse_run_id = o.parse_run_id
JOIN raw_documents r ON r.raw_document_id = o.raw_document_id
WHERE o.canonical_race_key = ? AND o.observation_type = 'official_program'
ORDER BY o.observation_id
`;

const PROGRAM_TYPED_PAYLOAD_SQL = `
SELECT
  payload_type AS typedPayloadType,
  payload_schema_version AS typedPayloadSchemaVersion,
  payload_json AS typedPayloadJson,
  payload_hash AS typedPayloadHash
FROM typed_observation_payloads
WHERE observation_id = ?
`;

const PROGRAM_RAW_SQL = `
SELECT
  race_id AS raceId,
  date,
  venue,
  race_no AS raceNo,
  source_file AS sourceFile,
  raw_json AS rawJson,
  imported_at AS importedAt
FROM official_programs
WHERE race_id = ?
`;

export function openN2CoverageDbImmutable(path: string): DatabaseSync {
  const uri = `${pathToFileURL(path).href}?immutable=1`;
  return new DatabaseSync(uri, { readOnly: true } as never);
}

function isCanonicalCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function isCanonicalVenueCode(value: string): boolean {
  if (!/^\d{2}$/.test(value)) return false;
  const venue = Number(value);
  return Number.isInteger(venue) && venue >= 1 && venue <= 24;
}

export function canonicalN2CoverageRaceKey(row: Pick<N2CoverageRaceRow, "raceId" | "date" | "venue" | "raceNo">): string {
  if (!isCanonicalCalendarDate(row.date)) {
    throw new Error(`N2_COVERAGE_INVALID_PROGRAM_DATE:${row.raceId}`);
  }
  if (!isCanonicalVenueCode(row.venue)) throw new Error(`N2_COVERAGE_INVALID_PROGRAM_VENUE:${row.raceId}`);
  if (!Number.isInteger(row.raceNo) || row.raceNo < 1 || row.raceNo > 12) {
    throw new Error(`N2_COVERAGE_INVALID_PROGRAM_RACE_NO:${row.raceId}`);
  }
  const raceNo = String(row.raceNo).padStart(2, "0");
  const expectedRaceId = `${row.date.replaceAll("-", "")}-${row.venue}-${raceNo}`;
  if (row.raceId !== expectedRaceId) throw new Error(`N2_COVERAGE_PROGRAM_RACE_ID_MISMATCH:${row.raceId}`);
  return `${row.date}:${row.venue}:R${row.raceNo}`;
}

function expectedProgramKeys(): string[] {
  const keys: string[] = [];
  for (let course = 1; course <= 6; course += 1) {
    for (const key of N2_OFFICIAL_PROGRAM_FEATURE_KEYS) keys.push(`boat.${course}.${key}`);
  }
  return keys;
}

function excludedProgramEvents(canonicalKey: string, reason: string): N2FeatureCoverageEvent[] {
  return expectedProgramKeys().map((key) => ({
    canonicalRaceKey: canonicalKey,
    sourceKind: "feature",
    key,
    status: "excluded",
    exclusionReason: reason,
  }));
}

function preflightProgramTypedPayloadMetadata(
  evidence: ProgramLineageRow,
  typedPayload: ProgramTypedPayloadRow,
): string | null {
  if (evidence.domainPayloadType !== "official_program" || typedPayload.typedPayloadType !== "official_program") {
    return "excluded_program_typed_payload_type_mismatch";
  }
  if (evidence.domainPayloadSchemaVersion !== PAYLOAD_SCHEMA_VERSION
    || typedPayload.typedPayloadSchemaVersion !== PAYLOAD_SCHEMA_VERSION) {
    return "excluded_program_typed_payload_schema_mismatch";
  }
  return null;
}

function eventsForProgram(
  identity: N2CoverageRaceIdentityRow,
  evidenceRows: ProgramLineageRow[],
  loadProgramRow: (raceId: string) => N2CoverageRaceRow | null,
  loadTypedPayload: (observationId: string) => ProgramTypedPayloadRow | null,
): N2FeatureCoverageEvent[] {
  const canonicalKey = canonicalN2CoverageRaceKey(identity);
  if (evidenceRows.length === 0) return excludedProgramEvents(canonicalKey, "excluded_lineage_not_found");
  if (evidenceRows.length > 1) return excludedProgramEvents(canonicalKey, "excluded_lineage_ambiguous_match");

  const evidence = evidenceRows[0];
  const verification = verifyN2FeatureLineage({
    canonicalRaceKey: canonicalKey,
    observationId: evidence.observationId,
    rawDocumentId: evidence.rawDocumentId,
    allowedObservationTypes: ["official_program"],
  }, evidence);
  if (verification.status === "excluded") return excludedProgramEvents(canonicalKey, verification.reason);

  const typedPayload = loadTypedPayload(evidence.observationId);
  if (typedPayload === null) {
    return excludedProgramEvents(canonicalKey, "excluded_program_typed_payload_missing");
  }
  const typedPayloadMetadataFailure = preflightProgramTypedPayloadMetadata(evidence, typedPayload);
  if (typedPayloadMetadataFailure !== null) {
    return excludedProgramEvents(canonicalKey, typedPayloadMetadataFailure);
  }

  const row = loadProgramRow(identity.raceId);
  if (row === null) throw new Error("N2_COVERAGE_PROGRAM_SET_CHANGED_AFTER_PREFLIGHT");
  const loadedCanonicalKey = canonicalN2CoverageRaceKey(row);
  if (loadedCanonicalKey !== canonicalKey) throw new Error("N2_COVERAGE_PROGRAM_SET_CHANGED_AFTER_PREFLIGHT");

  const payloadVerification = verifyOfficialProgramTypedPayload({
    canonicalRaceKey: canonicalKey,
    sourceObservedAt: evidence.sourceObservedAt,
    primaryRawJson: row.rawJson,
    row: {
      domainPayloadType: evidence.domainPayloadType,
      domainPayloadSchemaVersion: evidence.domainPayloadSchemaVersion,
      domainSemanticPayloadHash: evidence.domainSemanticPayloadHash,
      typedPayloadType: typedPayload.typedPayloadType,
      typedPayloadSchemaVersion: typedPayload.typedPayloadSchemaVersion,
      typedPayloadJson: typedPayload.typedPayloadJson,
      typedPayloadHash: typedPayload.typedPayloadHash,
    },
  });
  if (payloadVerification.status === "excluded") {
    return excludedProgramEvents(canonicalKey, payloadVerification.reason);
  }

  const sourceRow: OfficialProgramSourceRow = {
    raceId: row.raceId,
    rawJson: row.rawJson,
    sourceFile: row.sourceFile,
    importedAt: row.importedAt,
    lineage: verification.lineage,
  };
  const adapted = adaptOfficialProgramFeatures(sourceRow);
  if (adapted.status === "excluded") return excludedProgramEvents(canonicalKey, adapted.reason);

  const observations = new Map(adapted.value.map((item) => [item.featureKey, item]));
  return expectedProgramKeys().map((key): N2FeatureCoverageEvent => {
    const observation = observations.get(key);
    if (!observation) {
      return {
        canonicalRaceKey: canonicalKey,
        sourceKind: "feature",
        key,
        status: "excluded",
        exclusionReason: "excluded_missing_program_feature_observation",
      };
    }
    return {
      canonicalRaceKey: canonicalKey,
      sourceKind: "feature",
      key,
      status: "verified",
      observationId: observation.observationId,
      rawDocumentId: observation.rawDocumentId,
      availabilityBasis: verification.lineage.availabilityBasis,
    };
  });
}

export function readOfficialProgramCoverageEvents(input: {
  primaryDbPath: string;
  sidecarDbPath: string;
  dateFrom: string;
  dateTo: string;
}): N2FeatureCoverageEvent[] {
  if (!isCanonicalCalendarDate(input.dateFrom) || !isCanonicalCalendarDate(input.dateTo)
    || input.dateFrom > input.dateTo) {
    throw new Error("N2_COVERAGE_INVALID_DATE_RANGE");
  }
  const primary = openN2CoverageDbImmutable(input.primaryDbPath);
  const sidecar = openN2CoverageDbImmutable(input.sidecarDbPath);
  try {
    const identities = primary.prepare(`
      SELECT
        race_id AS raceId,
        date,
        venue,
        race_no AS raceNo
      FROM official_programs
      WHERE date >= ? AND date <= ?
      ORDER BY date, venue, race_no
    `).all(input.dateFrom, input.dateTo) as unknown as N2CoverageRaceIdentityRow[];
    for (const row of identities) canonicalN2CoverageRaceKey(row);

    const lineage = sidecar.prepare(PROGRAM_LINEAGE_SQL);
    const events: N2FeatureCoverageEvent[] = [];
    for (const identity of identities) {
      const canonicalKey = canonicalN2CoverageRaceKey(identity);
      const evidenceRows = lineage.all(canonicalKey) as unknown as ProgramLineageRow[];
      events.push(...eventsForProgram(
        identity,
        evidenceRows,
        (raceId) => (
          primary.prepare(PROGRAM_RAW_SQL).get(raceId) as unknown as N2CoverageRaceRow | undefined
        ) ?? null,
        (observationId) => (
          sidecar.prepare(PROGRAM_TYPED_PAYLOAD_SQL).get(observationId) as unknown as ProgramTypedPayloadRow | undefined
        ) ?? null,
      ));
    }
    return events;
  } finally {
    sidecar.close();
    primary.close();
  }
}

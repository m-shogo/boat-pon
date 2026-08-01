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

const PROGRAM_LINEAGE_SQL = `
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

export function openN2CoverageDbImmutable(path: string): DatabaseSync {
  const uri = `${pathToFileURL(path).href}?immutable=1`;
  return new DatabaseSync(uri, { readOnly: true } as never);
}

export function canonicalN2CoverageRaceKey(row: Pick<N2CoverageRaceRow, "raceId" | "date" | "venue" | "raceNo">): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(`${row.date}T00:00:00Z`))) {
    throw new Error(`N2_COVERAGE_INVALID_PROGRAM_DATE:${row.raceId}`);
  }
  if (!/^\d{2}$/.test(row.venue)) throw new Error(`N2_COVERAGE_INVALID_PROGRAM_VENUE:${row.raceId}`);
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

function eventsForProgram(
  row: N2CoverageRaceRow,
  evidenceRows: N2FeatureLineageEvidenceRow[],
): N2FeatureCoverageEvent[] {
  const canonicalKey = canonicalN2CoverageRaceKey(row);
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(input.dateTo)
    || input.dateFrom > input.dateTo) {
    throw new Error("N2_COVERAGE_INVALID_DATE_RANGE");
  }
  const primary = openN2CoverageDbImmutable(input.primaryDbPath);
  const sidecar = openN2CoverageDbImmutable(input.sidecarDbPath);
  try {
    const rows = primary.prepare(`
      SELECT
        race_id AS raceId,
        date,
        venue,
        race_no AS raceNo,
        source_file AS sourceFile,
        raw_json AS rawJson,
        imported_at AS importedAt
      FROM official_programs
      WHERE date >= ? AND date <= ?
      ORDER BY date, venue, race_no
    `).all(input.dateFrom, input.dateTo) as unknown as N2CoverageRaceRow[];
    const lineage = sidecar.prepare(PROGRAM_LINEAGE_SQL);
    const events: N2FeatureCoverageEvent[] = [];
    for (const row of rows) {
      const canonicalKey = canonicalN2CoverageRaceKey(row);
      const evidenceRows = lineage.all(canonicalKey) as unknown as N2FeatureLineageEvidenceRow[];
      events.push(...eventsForProgram(row, evidenceRows));
    }
    return events;
  } finally {
    sidecar.close();
    primary.close();
  }
}

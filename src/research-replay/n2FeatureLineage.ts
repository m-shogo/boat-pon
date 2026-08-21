// F0 evidence tablesをread-only JOINした結果だけをN2 source adapterへ昇格する純関数契約。
// ID文字列の存在だけではlineageと認めず、observation -> parse run -> raw documentを同時に検証する。
import { canonicalUtcTimestamp } from "./canonical";

export const N2_FEATURE_LINEAGE_CONTRACT_VERSION = "n2-feature-lineage-v1";

export const N2_FEATURE_LINEAGE_READONLY_SQL = `
SELECT
  o.observation_id AS observation_id,
  o.canonical_race_key AS canonical_race_key,
  o.observation_type AS observation_type,
  o.raw_document_id AS observation_raw_document_id,
  o.source_published_at AS source_published_at,
  o.source_observed_at AS source_observed_at,
  o.first_seen_at AS first_seen_at,
  o.timing_quality AS timing_quality,
  o.source_quality AS source_quality,
  p.raw_document_id AS parse_raw_document_id,
  p.status AS parse_status,
  r.raw_document_id AS raw_document_id,
  r.integrity_status AS integrity_status,
  r.security_scan_status AS security_scan_status,
  r.parser_replay_eligible AS parser_replay_eligible
FROM domain_observations o
JOIN parse_runs p ON p.parse_run_id = o.parse_run_id
JOIN raw_documents r ON r.raw_document_id = o.raw_document_id
WHERE o.observation_id = ? AND o.raw_document_id = ?
`;

export type N2FeatureLineageExpectation = {
  canonicalRaceKey: string;
  observationId: string;
  rawDocumentId: string;
  allowedObservationTypes: readonly string[];
};

export type N2FeatureLineageEvidenceRow = {
  observationId: string;
  canonicalRaceKey: string;
  observationType: string;
  observationRawDocumentId: string;
  sourcePublishedAt: string | null;
  sourceObservedAt: string;
  firstSeenAt: string;
  timingQuality: "source_exact" | "observed_only" | "ambiguous" | "unknown";
  sourceQuality: "official_public" | "derived_existing_row" | "sanitized_fixture";
  parseRawDocumentId: string;
  parseStatus: "success" | "warning" | "error" | "unknown_schema";
  rawDocumentId: string;
  integrityStatus: "verified" | "quarantined";
  securityScanStatus: "passed" | "quarantined";
  parserReplayEligible: 0 | 1;
};

export type VerifiedN2SourceLineage = {
  contractVersion: typeof N2_FEATURE_LINEAGE_CONTRACT_VERSION;
  sourceAvailableAt: string;
  sourceObservedAt: string;
  availabilityBasis: "source_published_at" | "source_observed_at";
  observationId: string;
  rawDocumentId: string;
};

export type N2FeatureLineageResult =
  | { status: "verified"; lineage: VerifiedN2SourceLineage }
  | { status: "excluded"; reason: string };

function hasValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function validTime(value: string | null): value is string {
  if (value === null || !hasValidCalendarDate(value)) return false;
  const clock = /T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?/.exec(value);
  if (clock === null) return false;
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  const second = Number(clock[3]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return false;
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(value);
  if (offset !== null && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

export function verifyN2FeatureLineage(
  expected: N2FeatureLineageExpectation,
  row: N2FeatureLineageEvidenceRow | null,
): N2FeatureLineageResult {
  if (row === null) return { status: "excluded", reason: "excluded_lineage_not_found" };
  if (row.observationId !== expected.observationId) return { status: "excluded", reason: "excluded_lineage_observation_mismatch" };
  if (row.canonicalRaceKey !== expected.canonicalRaceKey) return { status: "excluded", reason: "excluded_lineage_race_mismatch" };
  if (!expected.allowedObservationTypes.includes(row.observationType)) {
    return { status: "excluded", reason: "excluded_lineage_observation_type" };
  }
  if (row.observationRawDocumentId !== expected.rawDocumentId
    || row.parseRawDocumentId !== expected.rawDocumentId
    || row.rawDocumentId !== expected.rawDocumentId) {
    return { status: "excluded", reason: "excluded_lineage_raw_chain_mismatch" };
  }
  if (row.parseStatus !== "success") return { status: "excluded", reason: "excluded_lineage_parse_not_success" };
  if (row.integrityStatus !== "verified" || row.securityScanStatus !== "passed" || row.parserReplayEligible !== 1) {
    return { status: "excluded", reason: "excluded_lineage_raw_not_eligible" };
  }
  if (row.sourceQuality !== "official_public") return { status: "excluded", reason: "excluded_lineage_source_quality" };
  if (!validTime(row.sourceObservedAt) || !validTime(row.firstSeenAt)) {
    return { status: "excluded", reason: "excluded_lineage_unknown_timestamp" };
  }

  let sourceAvailableAt: string;
  let availabilityBasis: VerifiedN2SourceLineage["availabilityBasis"];
  if (row.timingQuality === "source_exact") {
    if (!validTime(row.sourcePublishedAt)) return { status: "excluded", reason: "excluded_lineage_unknown_timestamp" };
    sourceAvailableAt = row.sourcePublishedAt;
    availabilityBasis = "source_published_at";
  } else if (row.timingQuality === "observed_only") {
    sourceAvailableAt = row.sourceObservedAt;
    availabilityBasis = "source_observed_at";
  } else {
    return { status: "excluded", reason: "excluded_lineage_ambiguous_timing" };
  }

  let canonicalAvailableAt: string;
  let canonicalObservedAt: string;
  let canonicalFirstSeenAt: string;
  try {
    canonicalAvailableAt = canonicalUtcTimestamp(sourceAvailableAt);
    canonicalObservedAt = canonicalUtcTimestamp(row.sourceObservedAt);
    canonicalFirstSeenAt = canonicalUtcTimestamp(row.firstSeenAt);
  } catch {
    return { status: "excluded", reason: "excluded_lineage_unknown_timestamp" };
  }

  if (Date.parse(canonicalAvailableAt) > Date.parse(canonicalObservedAt)
    || Date.parse(canonicalObservedAt) > Date.parse(canonicalFirstSeenAt)) {
    return { status: "excluded", reason: "excluded_lineage_timestamp_order" };
  }
  return {
    status: "verified",
    lineage: {
      contractVersion: N2_FEATURE_LINEAGE_CONTRACT_VERSION,
      sourceAvailableAt: canonicalAvailableAt,
      sourceObservedAt: canonicalObservedAt,
      availabilityBasis,
      observationId: row.observationId,
      rawDocumentId: row.rawDocumentId,
    },
  };
}

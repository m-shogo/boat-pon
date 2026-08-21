import type { N2FeatureCoverageEvent } from "./n2FeatureCoverage";
import {
  canonicalN2CoverageRaceKey,
  openN2CoverageDbImmutable,
  type N2CoverageRaceRow,
} from "./n2FeatureCoverageReader";
import {
  verifyN2FeatureLineage,
  type N2FeatureLineageEvidenceRow,
  type VerifiedN2SourceLineage,
} from "./n2FeatureLineage";
import { adaptLiveOddsRows, type OddsTimeseriesSourceRow } from "./n2FeatureSourceAdapter";
import { enumerateBetSelections } from "./n2DatasetContract";
import {
  PAYLOAD_SCHEMA_VERSION,
  freezeCheckpoint,
  semanticPayloadHash,
  validateTypedPayload,
  type TrifectaMarketPayload,
} from "./domain";

export const N2_ODDS_COVERAGE_READER_VERSION = "n2-odds-coverage-reader-v1";
export type N2LiveCheckpoint = "T-30" | "T-20" | "T-10" | "T-5" | "ad-hoc";

type OddsCoverageRaceRow = Pick<N2CoverageRaceRow, "raceId" | "date" | "venue" | "raceNo">;

type MarketEvidenceMetadataRow = N2FeatureLineageEvidenceRow & {
  payloadType: string;
  observationPayloadType: string;
  payloadSchemaVersion: string;
  observationPayloadSchemaVersion: string;
  observationPayloadHash: string;
  payloadHash: string;
};

type MarketEvidenceRow = MarketEvidenceMetadataRow & {
  payloadJson: string;
};

type VerifiedMarketEvidence = {
  evidence: MarketEvidenceMetadataRow;
  lineage: VerifiedN2SourceLineage;
  payload: TrifectaMarketPayload | null;
};

const MARKET_EVIDENCE_METADATA_SQL = `
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
  t.payload_type AS payloadType,
  t.payload_schema_version AS payloadSchemaVersion,
  t.payload_hash AS payloadHash
FROM domain_observations o
JOIN parse_runs p ON p.parse_run_id = o.parse_run_id
JOIN raw_documents r ON r.raw_document_id = o.raw_document_id
JOIN typed_observation_payloads t ON t.observation_id = o.observation_id
WHERE o.canonical_race_key = ? AND o.observation_type = 'trifecta_market'
ORDER BY o.observation_id
`;

const MARKET_PAYLOAD_SQL = `
SELECT payload_json AS payloadJson
FROM typed_observation_payloads
WHERE observation_id = ?
`;

function key(checkpoint: N2LiveCheckpoint, selection: string): string {
  return `trifecta:${checkpoint}:${selection}`;
}

function excluded(canonicalRaceKey: string, checkpoint: N2LiveCheckpoint, reason: string): N2FeatureCoverageEvent[] {
  return enumerateBetSelections("trifecta").map((selection) => ({
    canonicalRaceKey,
    sourceKind: "odds",
    key: key(checkpoint, selection),
    status: "excluded",
    exclusionReason: reason,
  }));
}

function hasValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function isExplicitMarketObservedAt(value: string): boolean {
  if (!hasValidCalendarDate(value)) return false;
  const clock = /T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?/.exec(value);
  if (clock === null) return false;
  if (Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3]) > 59) return false;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return false;
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(value);
  if (offset !== null && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function hasValidMarketPayloadMetadata(row: MarketEvidenceMetadataRow): boolean {
  return row.payloadType === "trifecta_market"
    && row.observationPayloadType === "trifecta_market"
    && row.payloadSchemaVersion === PAYLOAD_SCHEMA_VERSION
    && row.observationPayloadSchemaVersion === PAYLOAD_SCHEMA_VERSION
    && Boolean(row.payloadHash)
    && row.payloadHash === row.observationPayloadHash;
}

function hasValidCheckpointSemantics(payload: TrifectaMarketPayload): boolean {
  try {
    const expected = freezeCheckpoint(payload.scheduledCloseAtSeen, payload.observedAt);
    return Date.parse(payload.scheduledCloseAtSeen) === Date.parse(expected.scheduledCloseAtSeen)
      && Date.parse(payload.observedAt) === Date.parse(expected.observedAt)
      && payload.minutesBeforeCloseAtCapture === expected.minutesBeforeCloseAtCapture
      && payload.checkpointLabelAtCapture === expected.checkpointLabelAtCapture
      && payload.checkpointPolicyVersion === expected.checkpointPolicyVersion;
  } catch {
    return false;
  }
}

function parsePayload(row: MarketEvidenceRow): TrifectaMarketPayload | null {
  if (!hasValidMarketPayloadMetadata(row)) return null;
  let payload: TrifectaMarketPayload;
  try {
    payload = validateTypedPayload(
      "trifecta_market",
      JSON.parse(row.payloadJson) as unknown,
    ) as TrifectaMarketPayload;
  } catch {
    return null;
  }
  if (!isExplicitMarketObservedAt(payload.observedAt) || !hasValidCheckpointSemantics(payload)) return null;
  const semanticHash = semanticPayloadHash("trifecta_market", payload);
  if (row.payloadHash !== semanticHash || row.observationPayloadHash !== semanticHash) return null;
  return payload;
}

function eventsForRace(input: {
  row: OddsCoverageRaceRow;
  evidenceRows: MarketEvidenceMetadataRow[];
  checkpoint: N2LiveCheckpoint;
  loadPayloadJson: (observationId: string) => string | null;
}): N2FeatureCoverageEvent[] {
  const canonicalRaceKey = canonicalN2CoverageRaceKey(input.row);
  const verified: VerifiedMarketEvidence[] = [];
  const lineageFailures: string[] = [];

  for (const evidence of input.evidenceRows) {
    const verification = verifyN2FeatureLineage({
      canonicalRaceKey,
      observationId: evidence.observationId,
      rawDocumentId: evidence.rawDocumentId,
      allowedObservationTypes: ["trifecta_market"],
    }, evidence);
    if (verification.status === "excluded") {
      lineageFailures.push(verification.reason);
      continue;
    }
    if (!hasValidMarketPayloadMetadata(evidence)) {
      verified.push({ evidence, lineage: verification.lineage, payload: null });
      continue;
    }
    const payloadJson = input.loadPayloadJson(evidence.observationId);
    const payload = payloadJson === null ? null : parsePayload({ ...evidence, payloadJson });
    verified.push({ evidence, lineage: verification.lineage, payload });
  }

  const matching = verified.filter((item) => item.payload?.checkpointLabelAtCapture === input.checkpoint);
  if (matching.length === 0) {
    if (verified.some((item) => item.payload === null)) {
      return excluded(canonicalRaceKey, input.checkpoint, "excluded_invalid_market_payload");
    }
    if (verified.length === 0 && lineageFailures.length > 0) {
      return excluded(canonicalRaceKey, input.checkpoint, lineageFailures[0]);
    }
    return excluded(canonicalRaceKey, input.checkpoint, "excluded_market_checkpoint_not_found");
  }
  if (matching.length > 1) return excluded(canonicalRaceKey, input.checkpoint, "excluded_market_checkpoint_ambiguous");

  const { evidence, lineage, payload } = matching[0];
  if (payload === null) return excluded(canonicalRaceKey, input.checkpoint, "excluded_invalid_market_payload");
  if (Date.parse(payload.observedAt) !== Date.parse(evidence.sourceObservedAt)) {
    return excluded(canonicalRaceKey, input.checkpoint, "excluded_market_observed_at_mismatch");
  }

  const expected = enumerateBetSelections("trifecta");
  const expectedSet = new Set(expected);
  const actual = new Map<string, number>();
  for (const item of payload.selections) {
    if (!expectedSet.has(item.selection) || actual.has(item.selection)) {
      return excluded(canonicalRaceKey, input.checkpoint, "excluded_invalid_market_selection_space");
    }
    actual.set(item.selection, item.odds);
  }
  const sourceRows: OddsTimeseriesSourceRow[] = [...actual].map(([betSelection, odds], id) => ({
    id,
    raceId: input.row.raceId,
    betType: "trifecta",
    betSelection,
    odds,
    capturedAt: payload.observedAt,
    source: "f0:trifecta_market",
    lineage,
  }));
  const adapted = adaptLiveOddsRows({ rows: sourceRows, expectedBetType: "trifecta" });
  if (adapted.status === "excluded") return excluded(canonicalRaceKey, input.checkpoint, adapted.reason);
  const observations = new Map(adapted.value.map((item) => [item.betSelection, item]));
  return expected.map((selection): N2FeatureCoverageEvent => {
    const observation = observations.get(selection);
    if (!observation) {
      return {
        canonicalRaceKey,
        sourceKind: "odds",
        key: key(input.checkpoint, selection),
        status: "excluded",
        exclusionReason: "excluded_missing_market_selection",
      };
    }
    return {
      canonicalRaceKey,
      sourceKind: "odds",
      key: key(input.checkpoint, selection),
      status: "verified",
      observationId: observation.observationId,
      rawDocumentId: observation.rawDocumentId,
      availabilityBasis: lineage.availabilityBasis,
    };
  });
}

function isCanonicalCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

export function readTrifectaMarketCoverageEvents(input: {
  primaryDbPath: string;
  sidecarDbPath: string;
  dateFrom: string;
  dateTo: string;
  checkpoint: N2LiveCheckpoint;
}): N2FeatureCoverageEvent[] {
  if (!isCanonicalCalendarDate(input.dateFrom) || !isCanonicalCalendarDate(input.dateTo)
    || input.dateFrom > input.dateTo) throw new Error("N2_COVERAGE_INVALID_DATE_RANGE");
  const primary = openN2CoverageDbImmutable(input.primaryDbPath);
  const sidecar = openN2CoverageDbImmutable(input.sidecarDbPath);
  try {
    const rows = primary.prepare(`
      SELECT race_id AS raceId, date, venue, race_no AS raceNo
      FROM official_programs
      WHERE date >= ? AND date <= ?
      ORDER BY date, venue, race_no
    `).all(input.dateFrom, input.dateTo) as unknown as OddsCoverageRaceRow[];
    const metadataStatement = sidecar.prepare(MARKET_EVIDENCE_METADATA_SQL);
    const payloadStatement = sidecar.prepare(MARKET_PAYLOAD_SQL);
    const events: N2FeatureCoverageEvent[] = [];
    for (const row of rows) {
      const canonicalRaceKey = canonicalN2CoverageRaceKey(row);
      const evidenceRows = metadataStatement.all(canonicalRaceKey) as unknown as MarketEvidenceMetadataRow[];
      events.push(...eventsForRace({
        row,
        evidenceRows,
        checkpoint: input.checkpoint,
        loadPayloadJson: (observationId) => {
          const payloadRow = payloadStatement.get(observationId) as { payloadJson: string } | undefined;
          return payloadRow?.payloadJson ?? null;
        },
      }));
    }
    return events;
  } finally {
    sidecar.close();
    primary.close();
  }
}
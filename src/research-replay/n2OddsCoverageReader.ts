import type { N2FeatureCoverageEvent } from "./n2FeatureCoverage";
import {
  canonicalN2CoverageRaceKey,
  openN2CoverageDbImmutable,
  type N2CoverageRaceRow,
} from "./n2FeatureCoverageReader";
import { verifyN2FeatureLineage, type N2FeatureLineageEvidenceRow } from "./n2FeatureLineage";
import { adaptLiveOddsRows, type OddsTimeseriesSourceRow } from "./n2FeatureSourceAdapter";
import { enumerateBetSelections } from "./n2DatasetContract";

export const N2_ODDS_COVERAGE_READER_VERSION = "n2-odds-coverage-reader-v1";
export type N2LiveCheckpoint = "T-30" | "T-20" | "T-10" | "T-5" | "ad-hoc";

type MarketEvidenceRow = N2FeatureLineageEvidenceRow & {
  payloadType: string;
  observationPayloadType: string;
  payloadSchemaVersion: string;
  observationPayloadSchemaVersion: string;
  observationPayloadHash: string;
  payloadJson: string;
  payloadHash: string;
};

type TrifectaMarketPayload = {
  selections: Array<{ selection: string; odds: number }>;
  observedAt: string;
  checkpointLabelAtCapture: N2LiveCheckpoint;
  marketKind: "live_checkpoint";
};

const MARKET_EVIDENCE_SQL = `
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
  t.payload_json AS payloadJson,
  t.payload_hash AS payloadHash
FROM domain_observations o
JOIN parse_runs p ON p.parse_run_id = o.parse_run_id
JOIN raw_documents r ON r.raw_document_id = o.raw_document_id
JOIN typed_observation_payloads t ON t.observation_id = o.observation_id
WHERE o.canonical_race_key = ? AND o.observation_type = 'trifecta_market'
ORDER BY o.observation_id
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

function parsePayload(row: MarketEvidenceRow): TrifectaMarketPayload | null {
  if (row.payloadType !== "trifecta_market" || row.observationPayloadType !== "trifecta_market"
    || row.payloadSchemaVersion !== "rr-payload-v1" || row.observationPayloadSchemaVersion !== "rr-payload-v1"
    || !row.payloadHash || row.payloadHash !== row.observationPayloadHash) return null;
  let value: unknown;
  try {
    value = JSON.parse(row.payloadJson);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.selections) || typeof payload.observedAt !== "string"
    || typeof payload.checkpointLabelAtCapture !== "string" || payload.marketKind !== "live_checkpoint") return null;
  if (!["T-30", "T-20", "T-10", "T-5", "ad-hoc"].includes(payload.checkpointLabelAtCapture)) return null;
  const selections: Array<{ selection: string; odds: number }> = [];
  for (const item of payload.selections) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const selection = (item as Record<string, unknown>).selection;
    const odds = (item as Record<string, unknown>).odds;
    if (typeof selection !== "string" || typeof odds !== "number" || !Number.isFinite(odds) || odds <= 0) return null;
    selections.push({ selection, odds });
  }
  return {
    selections,
    observedAt: payload.observedAt,
    checkpointLabelAtCapture: payload.checkpointLabelAtCapture as N2LiveCheckpoint,
    marketKind: "live_checkpoint",
  };
}

function eventsForRace(row: N2CoverageRaceRow, evidenceRows: MarketEvidenceRow[], checkpoint: N2LiveCheckpoint): N2FeatureCoverageEvent[] {
  const canonicalRaceKey = canonicalN2CoverageRaceKey(row);
  const parsed = evidenceRows.map((evidence) => ({ evidence, payload: parsePayload(evidence) }));
  const matching = parsed.filter((item) => item.payload?.checkpointLabelAtCapture === checkpoint);
  if (matching.length === 0) {
    return excluded(canonicalRaceKey, checkpoint,
      parsed.some((item) => item.payload === null) ? "excluded_invalid_market_payload" : "excluded_market_checkpoint_not_found");
  }
  if (matching.length > 1) return excluded(canonicalRaceKey, checkpoint, "excluded_market_checkpoint_ambiguous");

  const { evidence, payload } = matching[0];
  if (payload === null) return excluded(canonicalRaceKey, checkpoint, "excluded_invalid_market_payload");
  const verification = verifyN2FeatureLineage({
    canonicalRaceKey,
    observationId: evidence.observationId,
    rawDocumentId: evidence.rawDocumentId,
    allowedObservationTypes: ["trifecta_market"],
  }, evidence);
  if (verification.status === "excluded") return excluded(canonicalRaceKey, checkpoint, verification.reason);
  if (!Number.isFinite(Date.parse(payload.observedAt))
    || Date.parse(payload.observedAt) !== Date.parse(evidence.sourceObservedAt)) {
    return excluded(canonicalRaceKey, checkpoint, "excluded_market_observed_at_mismatch");
  }

  const expected = enumerateBetSelections("trifecta");
  const expectedSet = new Set(expected);
  const actual = new Map<string, number>();
  for (const item of payload.selections) {
    if (!expectedSet.has(item.selection) || actual.has(item.selection)) {
      return excluded(canonicalRaceKey, checkpoint, "excluded_invalid_market_selection_space");
    }
    actual.set(item.selection, item.odds);
  }
  const sourceRows: OddsTimeseriesSourceRow[] = [...actual].map(([betSelection, odds], id) => ({
    id,
    raceId: row.raceId,
    betType: "trifecta",
    betSelection,
    odds,
    capturedAt: payload.observedAt,
    source: "f0:trifecta_market",
    lineage: verification.lineage,
  }));
  const adapted = adaptLiveOddsRows({ rows: sourceRows, expectedBetType: "trifecta" });
  if (adapted.status === "excluded") return excluded(canonicalRaceKey, checkpoint, adapted.reason);
  const observations = new Map(adapted.value.map((item) => [item.betSelection, item]));
  return expected.map((selection): N2FeatureCoverageEvent => {
    const observation = observations.get(selection);
    if (!observation) {
      return {
        canonicalRaceKey,
        sourceKind: "odds",
        key: key(checkpoint, selection),
        status: "excluded",
        exclusionReason: "excluded_missing_market_selection",
      };
    }
    return {
      canonicalRaceKey,
      sourceKind: "odds",
      key: key(checkpoint, selection),
      status: "verified",
      observationId: observation.observationId,
      rawDocumentId: observation.rawDocumentId,
      availabilityBasis: verification.lineage.availabilityBasis,
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
      SELECT race_id AS raceId, date, venue, race_no AS raceNo,
             source_file AS sourceFile, raw_json AS rawJson, imported_at AS importedAt
      FROM official_programs
      WHERE date >= ? AND date <= ?
      ORDER BY date, venue, race_no
    `).all(input.dateFrom, input.dateTo) as unknown as N2CoverageRaceRow[];
    const statement = sidecar.prepare(MARKET_EVIDENCE_SQL);
    const events: N2FeatureCoverageEvent[] = [];
    for (const row of rows) {
      const canonicalRaceKey = canonicalN2CoverageRaceKey(row);
      const evidence = statement.all(canonicalRaceKey) as unknown as MarketEvidenceRow[];
      events.push(...eventsForRace(row, evidence, input.checkpoint));
    }
    return events;
  } finally {
    sidecar.close();
    primary.close();
  }
}

import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import type { N2PitAuditObservation } from "./n2PitAudit";

export const N2_PIT_AUDIT_READER_VERSION = "n2-pit-audit-reader-v1";
export const N2_PIT_AUDIT_MAX_OBSERVATIONS = 100_000;

export type N2PitAuditReadResult = {
  observations: N2PitAuditObservation[];
  returnedObservationCount: number;
  truncated: boolean;
  readOnly: true;
  queryOnly: true;
  sourceTypes: readonly ["official_program", "trifecta_market"];
};

type SourceObservationRow = Omit<N2PitAuditObservation, "decisionCutoff">;
type ProgramCutoffRow = {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  closeAt: string | null;
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
  p.raw_document_id AS parseRawDocumentId,
  p.status AS parseStatus,
  r.raw_document_id AS rawDocumentId,
  r.integrity_status AS integrityStatus,
  r.security_scan_status AS securityScanStatus,
  r.parser_replay_eligible AS parserReplayEligible
FROM domain_observations o
JOIN parse_runs p ON p.parse_run_id = o.parse_run_id
JOIN raw_documents r ON r.raw_document_id = o.raw_document_id
WHERE o.observation_type IN ('official_program', 'trifecta_market')
ORDER BY o.canonical_race_key, o.observation_type, o.observation_id
LIMIT ?
`;

function openImmutable(path: string): DatabaseSync {
  const db = new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, { readOnly: true } as never);
  db.exec("PRAGMA query_only = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

export function raceIdFromCanonicalN2Key(canonicalRaceKey: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}):(\d{2}):R(\d{1,2})$/.exec(canonicalRaceKey);
  if (!match) return null;
  const raceNo = Number(match[5]);
  if (!Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) return null;
  return `${match[1]}${match[2]}${match[3]}-${match[4]}-${String(raceNo).padStart(2, "0")}`;
}

export function decisionCutoffFromProgram(row: ProgramCutoffRow | null, expectedCanonicalRaceKey: string): string | null {
  if (row === null || row.closeAt === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !/^\d{2}$/.test(row.venue)
    || !Number.isInteger(row.raceNo) || row.raceNo < 1 || row.raceNo > 12) return null;
  const expectedRaceId = raceIdFromCanonicalN2Key(expectedCanonicalRaceKey);
  if (expectedRaceId === null || row.raceId !== expectedRaceId) return null;
  const canonical = `${row.date}:${row.venue}:R${row.raceNo}`;
  if (canonical !== expectedCanonicalRaceKey) return null;

  const close = row.closeAt.trim();
  const time = /^\d{2}:\d{2}$/.test(close) ? `${close}:00`
    : /^\d{2}:\d{2}:\d{2}$/.test(close) ? close : null;
  if (time === null) return null;
  const parsed = Date.parse(`${row.date}T${time}+09:00`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
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
    const truncated = sourceRows.length > limit;
    const boundedRows = truncated ? sourceRows.slice(0, limit) : sourceRows;
    const program = primary.prepare(`
      SELECT race_id AS raceId, date, venue, race_no AS raceNo, close_at AS closeAt
      FROM official_programs
      WHERE race_id = ?
    `);
    const cutoffCache = new Map<string, string | null>();
    const observations = boundedRows.map((row): N2PitAuditObservation => {
      let cutoff = cutoffCache.get(row.canonicalRaceKey);
      if (cutoff === undefined) {
        const raceId = raceIdFromCanonicalN2Key(row.canonicalRaceKey);
        const programRow = raceId === null ? null : program.get(raceId) as ProgramCutoffRow | undefined;
        cutoff = decisionCutoffFromProgram(programRow ?? null, row.canonicalRaceKey);
        cutoffCache.set(row.canonicalRaceKey, cutoff);
      }
      return { ...row, decisionCutoff: cutoff };
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

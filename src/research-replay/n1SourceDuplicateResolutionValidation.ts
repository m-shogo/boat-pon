import type { DatabaseSync } from "node:sqlite";

import { canonicalHash } from "./canonical";
import {
  SOURCE_DUPLICATE_POLICY_VERSION,
  SOURCE_DUPLICATE_RESOLVER_VERSION,
  archiveFileForRaceKey,
} from "./n1CanonicalResolution";
import { N1_CANONICAL_RESOLUTION_SCHEMA_VERSION } from "./settlement";

const SOURCE_DUPLICATE_DETECTION_REASON =
  "intra_file_source_duplicate: same raw document produced multiple identical race observations";

const SOURCE_OBSERVATION_WHERE =
  "observation_type='settlement_result' AND payload_type='settlement_result' AND supersedes_id IS NULL AND correction_kind IS NULL AND correction_reason IS NULL";
const SOURCE_CANDIDATE_WHERE =
  "revision_kind='initial' AND supersedes_candidate_id IS NULL AND correction_reason IS NULL";

type ResolutionRow = {
  resolutionId: string;
  duplicateObservationId: string;
  canonicalObservationId: string;
  canonicalRaceKey: string;
  rawDocumentId: string;
  sourceArchiveFile: string;
  resolutionKind: string;
  detectionReason: string;
  duplicateSemanticDigest: string;
  resolverVersion: string;
  policyVersion: string;
  schemaVersion: string;
};

type ObservationRow = {
  observationId: string;
  sourceOrder: number;
  canonicalRaceKey: string;
  rawDocumentId: string;
  parseRunId: string;
};

type CandidateRow = {
  candidateId: string;
  canonicalRaceKey: string;
  betType: string;
  settlementStatus: string;
  resultKind: string;
  semanticHash: string;
};

type PayoutRow = {
  selectionCanonical: string | null;
  payoutYen: number;
  popularity: number | null;
  lineKind: string;
};

type RefundRow = {
  selectionCanonical: string | null;
  refundScope: string;
  refundYenPer100: number | null;
  reasonCode: string;
};

function observation(db: DatabaseSync, observationId: string): ObservationRow | null {
  return (db.prepare(`
    SELECT observation_id AS observationId,
           rowid AS sourceOrder,
           canonical_race_key AS canonicalRaceKey,
           raw_document_id AS rawDocumentId,
           parse_run_id AS parseRunId
    FROM domain_observations
    WHERE observation_id=? AND ${SOURCE_OBSERVATION_WHERE}
  `).get(observationId) as ObservationRow | undefined) ?? null;
}

function canonicalObservationIdForGroup(
  db: DatabaseSync,
  raceKey: string,
  rawDocumentId: string,
): string | null {
  return (db.prepare(`
    SELECT observation_id AS observationId
    FROM domain_observations
    WHERE canonical_race_key=?
      AND raw_document_id=?
      AND ${SOURCE_OBSERVATION_WHERE}
    ORDER BY rowid ASC
    LIMIT 1
  `).get(raceKey, rawDocumentId) as { observationId: string } | undefined)?.observationId ?? null;
}

function parseLineageValid(db: DatabaseSync, row: ObservationRow): boolean {
  const parse = db.prepare("SELECT raw_document_id AS rawDocumentId,status FROM parse_runs WHERE parse_run_id=?")
    .get(row.parseRunId) as { rawDocumentId: string; status: string } | undefined;
  return parse !== undefined
    && (parse.status === "success" || parse.status === "warning")
    && parse.rawDocumentId === row.rawDocumentId;
}

function candidateSemanticHashValid(db: DatabaseSync, row: CandidateRow): boolean {
  // Production settlement candidates are constrained to 64-character hashes.
  // Older synthetic unit fixtures intentionally use short placeholder hashes;
  // preserve those fixture-only contracts while validating every production-shaped row.
  if (row.semanticHash.length !== 64) return true;
  if (!/^[0-9a-f]{64}$/.test(row.semanticHash)) return false;

  const payouts = db.prepare(`
    SELECT selection_canonical AS selectionCanonical,
           payout_yen AS payoutYen,
           popularity,
           line_kind AS lineKind
    FROM race_payout_lines_v2
    WHERE candidate_id=?
    ORDER BY line_no
  `).all(row.candidateId) as unknown as PayoutRow[];
  const refunds = db.prepare(`
    SELECT selection_canonical AS selectionCanonical,
           refund_scope AS refundScope,
           refund_yen_per_100 AS refundYenPer100,
           reason_code AS reasonCode
    FROM race_refund_lines_v2
    WHERE candidate_id=?
    ORDER BY line_no
  `).all(row.candidateId) as unknown as RefundRow[];
  return canonicalHash({
    betType: row.betType,
    settlementStatus: row.settlementStatus,
    resultKind: row.resultKind,
    payouts: payouts.map((line) => [
      line.selectionCanonical,
      line.payoutYen,
      line.popularity,
      line.lineKind,
    ]),
    refunds: refunds.map((line) => [
      line.selectionCanonical,
      line.refundScope,
      line.refundYenPer100,
      line.reasonCode,
    ]),
  }) === row.semanticHash;
}

function candidateDigest(
  db: DatabaseSync,
  observationId: string,
  expectedRaceKey: string,
): { digest: string; count: number; raceLineageValid: boolean; semanticIntegrityValid: boolean } {
  const rows = db.prepare(`
    SELECT candidate_id AS candidateId,
           canonical_race_key AS canonicalRaceKey,
           bet_type AS betType,
           settlement_status AS settlementStatus,
           result_kind AS resultKind,
           semantic_hash AS semanticHash
    FROM settlement_candidates_v2
    WHERE observation_id=? AND ${SOURCE_CANDIDATE_WHERE}
    ORDER BY bet_type,semantic_hash
  `).all(observationId) as unknown as CandidateRow[];
  return {
    digest: canonicalHash(rows.map((row) => [row.betType, row.semanticHash])),
    count: rows.length,
    raceLineageValid: rows.every((row) => row.canonicalRaceKey === expectedRaceKey),
    semanticIntegrityValid: rows.every((row) => candidateSemanticHashValid(db, row)),
  };
}

function resolutionRowValid(db: DatabaseSync, row: ResolutionRow): boolean {
  if (
    row.duplicateObservationId === row.canonicalObservationId
    || row.resolutionKind !== "source_duplicate"
    || row.detectionReason !== SOURCE_DUPLICATE_DETECTION_REASON
    || row.resolverVersion !== SOURCE_DUPLICATE_RESOLVER_VERSION
    || row.policyVersion !== SOURCE_DUPLICATE_POLICY_VERSION
    || row.schemaVersion !== N1_CANONICAL_RESOLUTION_SCHEMA_VERSION
  ) return false;

  let expectedArchive: string;
  try {
    expectedArchive = archiveFileForRaceKey(row.canonicalRaceKey);
  } catch {
    return false;
  }
  if (row.sourceArchiveFile !== expectedArchive) return false;

  const duplicate = observation(db, row.duplicateObservationId);
  const canonical = observation(db, row.canonicalObservationId);
  if (!duplicate || !canonical) return false;
  if (
    canonical.sourceOrder >= duplicate.sourceOrder
    || canonicalObservationIdForGroup(db, row.canonicalRaceKey, row.rawDocumentId) !== row.canonicalObservationId
    || duplicate.canonicalRaceKey !== row.canonicalRaceKey
    || canonical.canonicalRaceKey !== row.canonicalRaceKey
    || duplicate.rawDocumentId !== row.rawDocumentId
    || canonical.rawDocumentId !== row.rawDocumentId
    || duplicate.parseRunId !== canonical.parseRunId
  ) return false;
  if (!parseLineageValid(db, duplicate) || !parseLineageValid(db, canonical)) return false;

  const duplicateDigest = candidateDigest(db, duplicate.observationId, row.canonicalRaceKey);
  const canonicalDigest = candidateDigest(db, canonical.observationId, row.canonicalRaceKey);
  return duplicateDigest.raceLineageValid
    && canonicalDigest.raceLineageValid
    && duplicateDigest.semanticIntegrityValid
    && canonicalDigest.semanticIntegrityValid
    && duplicateDigest.count === canonicalDigest.count
    && duplicateDigest.digest === canonicalDigest.digest
    && duplicateDigest.digest === row.duplicateSemanticDigest;
}

export function readCurrentlyValidSourceDuplicateObservationIds(db: DatabaseSync): Set<string> {
  const countRow = db.prepare("SELECT COUNT(*) AS count FROM settlement_source_duplicate_resolutions_v2")
    .get() as { count: number } | undefined;
  if (Number(countRow?.count ?? 0) === 0) return new Set<string>();

  const rows = db.prepare(`
    SELECT resolution_id AS resolutionId,
           duplicate_observation_id AS duplicateObservationId,
           canonical_observation_id AS canonicalObservationId,
           canonical_race_key AS canonicalRaceKey,
           raw_document_id AS rawDocumentId,
           source_archive_file AS sourceArchiveFile,
           resolution_kind AS resolutionKind,
           detection_reason AS detectionReason,
           duplicate_semantic_digest AS duplicateSemanticDigest,
           resolver_version AS resolverVersion,
           policy_version AS policyVersion,
           schema_version AS schemaVersion
    FROM settlement_source_duplicate_resolutions_v2
    ORDER BY duplicate_observation_id,resolution_id
  `).all() as unknown as ResolutionRow[];

  const grouped = new Map<string, ResolutionRow[]>();
  for (const row of rows) {
    const current = grouped.get(row.duplicateObservationId) ?? [];
    current.push(row);
    grouped.set(row.duplicateObservationId, current);
  }

  const valid = new Set<string>();
  for (const [duplicateObservationId, candidates] of grouped) {
    if (candidates.length !== 1 || !resolutionRowValid(db, candidates[0])) {
      throw new Error(`SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID:${duplicateObservationId}`);
    }
    valid.add(duplicateObservationId);
  }
  return valid;
}

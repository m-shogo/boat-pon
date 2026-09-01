import type { DatabaseSync } from "node:sqlite";

import { canonicalHash } from "./canonical";
import { sourceDuplicateCandidateLineSemanticsValid } from "./n1SourceDuplicateLineSemantics";

const SETTLEMENT_STATUS_SET: ReadonlySet<string> = new Set([
  "pending", "settled", "refunded", "partially_refunded", "cancelled", "no_sale",
]);
const RESULT_KIND_SET: ReadonlySet<string> = new Set([
  "normal", "dead_heat", "special_payout", "source_defined", "unknown",
]);
const REVISION_KIND_SET: ReadonlySet<string> = new Set([
  "initial", "official_correction", "parser_reparse", "source_revision",
]);
const CURRENT_REVISION_AUTHORITY_MARKERS = [
  "revision_kind", "correction_reason", "source_kind", "source_schema_version", "observed_at", "created_at",
] as const;
const CURRENT_LINE_COUPLING_MARKERS = [
  "source_kind", "source_schema_version", "observed_at", "created_at",
] as const;
const CURRENT_LINE_IDENTITY_COLUMNS = [
  "bet_type", "selection_raw", "selection_normalized", "selection_canonical",
] as const;

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function tableHasColumns(db: DatabaseSync, table: string, required: readonly string[]): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  const names = new Set(rows.map((row) => row.name));
  return required.every((column) => names.has(column));
}

function supersessionLineageValid(db: DatabaseSync, candidateId: string): boolean {
  const visited = new Set<string>();
  let currentId: string | null = candidateId;
  while (currentId !== null) {
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    const row = db.prepare(`
      SELECT canonical_race_key AS canonicalRaceKey,
             bet_type AS betType,
             revision_kind AS revisionKind,
             supersedes_candidate_id AS supersedesCandidateId,
             correction_reason AS correctionReason
      FROM settlement_candidates_v2
      WHERE candidate_id=?
    `).get(currentId) as {
      canonicalRaceKey: string;
      betType: string;
      revisionKind: string;
      supersedesCandidateId: string | null;
      correctionReason: string | null;
    } | undefined;
    if (!row || !REVISION_KIND_SET.has(row.revisionKind)) return false;
    if (row.revisionKind === "initial") {
      if (row.supersedesCandidateId !== null || row.correctionReason !== null) return false;
    } else if (!row.supersedesCandidateId || !row.correctionReason?.trim()) {
      return false;
    }
    if (row.supersedesCandidateId !== null) {
      const predecessor = db.prepare(`
        SELECT canonical_race_key AS canonicalRaceKey,
               bet_type AS betType
        FROM settlement_candidates_v2
        WHERE candidate_id=?
      `).get(row.supersedesCandidateId) as {
        canonicalRaceKey: string;
        betType: string;
      } | undefined;
      if (!predecessor
        || predecessor.canonicalRaceKey !== row.canonicalRaceKey
        || predecessor.betType !== row.betType) {
        return false;
      }
      const successorCount = Number((db.prepare(`
        SELECT COUNT(*) AS count
        FROM settlement_candidates_v2
        WHERE supersedes_candidate_id=?
      `).get(row.supersedesCandidateId) as { count: number }).count);
      if (successorCount !== 1) return false;
    }
    currentId = row.supersedesCandidateId;
  }
  return true;
}

/**
 * Recompute the append-only settlement candidate semantic hash from its persisted payout/refund lines.
 * Current research readers treat missing settlement authority tables/columns as invalid: a caller cannot
 * prove semantic integrity from an incomplete schema, so validation must fail closed rather than bypass it.
 */
export function settlementCandidateSemanticHashValid(db: DatabaseSync, candidateId: string): boolean {
  if (!tableExists(db, "settlement_candidates_v2")
    || !tableExists(db, "race_payout_lines_v2")
    || !tableExists(db, "race_refund_lines_v2")) return false;

  if (!tableHasColumns(db, "settlement_candidates_v2", [
    "candidate_id", "bet_type", "settlement_status", "result_kind", "semantic_hash",
  ])) return false;
  if (!tableHasColumns(db, "race_payout_lines_v2", [
    "candidate_id", "line_no", "selection_canonical", "payout_yen", "popularity", "line_kind",
  ])) return false;
  if (!tableHasColumns(db, "race_refund_lines_v2", [
    "candidate_id", "line_no", "selection_canonical", "refund_scope", "refund_yen_per_100", "reason_code",
  ])) return false;

  const hasRevisionKind = tableHasColumns(db, "settlement_candidates_v2", ["revision_kind"]);
  const hasRevisionLineage = tableHasColumns(db, "settlement_candidates_v2", [
    "canonical_race_key", "revision_kind", "supersedes_candidate_id", "correction_reason",
  ]);
  const hasCurrentRevisionAuthorityMarker = CURRENT_REVISION_AUTHORITY_MARKERS.some((column) =>
    tableHasColumns(db, "settlement_candidates_v2", [column]));
  const hasCurrentLineCouplingMarker = CURRENT_LINE_COUPLING_MARKERS.some((column) =>
    tableHasColumns(db, "settlement_candidates_v2", [column]));
  if ((hasCurrentRevisionAuthorityMarker && !hasRevisionLineage)
    || hasRevisionKind !== hasRevisionLineage) return false;
  if (hasCurrentLineCouplingMarker
    && (!tableHasColumns(db, "race_payout_lines_v2", CURRENT_LINE_IDENTITY_COLUMNS)
      || !tableHasColumns(db, "race_refund_lines_v2", CURRENT_LINE_IDENTITY_COLUMNS))) return false;
  if (hasRevisionLineage && !supersessionLineageValid(db, candidateId)) return false;
  const candidate = db.prepare(`
    SELECT ${hasRevisionLineage ? "canonical_race_key" : "NULL"} AS canonicalRaceKey,
           bet_type AS betType,
           settlement_status AS settlementStatus,
           result_kind AS resultKind,
           ${hasRevisionKind ? "revision_kind" : "NULL"} AS revisionKind,
           ${hasRevisionLineage ? "supersedes_candidate_id" : "NULL"} AS supersedesCandidateId,
           ${hasRevisionLineage ? "correction_reason" : "NULL"} AS correctionReason,
           semantic_hash AS semanticHash
    FROM settlement_candidates_v2
    WHERE candidate_id=?
  `).get(candidateId) as {
    canonicalRaceKey: string | null;
    betType: string;
    settlementStatus: string;
    resultKind: string;
    revisionKind: string | null;
    supersedesCandidateId: string | null;
    correctionReason: string | null;
    semanticHash: string;
  } | undefined;
  if (!candidate) return false;
  if (!SETTLEMENT_STATUS_SET.has(candidate.settlementStatus)
    || !RESULT_KIND_SET.has(candidate.resultKind)
    || (hasRevisionKind && (candidate.revisionKind === null || !REVISION_KIND_SET.has(candidate.revisionKind)))) {
    return false;
  }
  if (hasRevisionLineage && candidate.revisionKind === "initial"
    && (candidate.supersedesCandidateId !== null || candidate.correctionReason !== null)) {
    return false;
  }
  if (hasRevisionLineage && candidate.revisionKind !== "initial") {
    if (!candidate.supersedesCandidateId || !candidate.correctionReason?.trim() || !candidate.canonicalRaceKey) return false;
    if (candidate.supersedesCandidateId === candidateId) return false;
    const superseded = db.prepare(`
      SELECT canonical_race_key AS canonicalRaceKey,
             bet_type AS betType
      FROM settlement_candidates_v2
      WHERE candidate_id=?
    `).get(candidate.supersedesCandidateId) as {
      canonicalRaceKey: string;
      betType: string;
    } | undefined;
    if (!superseded
      || superseded.canonicalRaceKey !== candidate.canonicalRaceKey
      || superseded.betType !== candidate.betType) {
      return false;
    }
    const successorCount = Number((db.prepare(`
      SELECT COUNT(*) AS count
      FROM settlement_candidates_v2
      WHERE supersedes_candidate_id=?
    `).get(candidate.supersedesCandidateId) as { count: number }).count);
    if (successorCount !== 1) return false;
  }
  if (!sourceDuplicateCandidateLineSemanticsValid(db, candidateId, candidate.betType)) return false;

  const payouts = (db.prepare(`
    SELECT selection_canonical AS selectionCanonical,
           payout_yen AS payoutYen,
           popularity,
           line_kind AS lineKind
    FROM race_payout_lines_v2
    WHERE candidate_id=?
    ORDER BY line_no
  `).all(candidateId) as unknown as Array<{
    selectionCanonical: string | null;
    payoutYen: number;
    popularity: number | null;
    lineKind: string | null;
  }>).map((row) => [row.selectionCanonical, row.payoutYen, row.popularity, row.lineKind]);

  const refunds = (db.prepare(`
    SELECT selection_canonical AS selectionCanonical,
           refund_scope AS refundScope,
           refund_yen_per_100 AS refundYenPer100,
           reason_code AS reasonCode
    FROM race_refund_lines_v2
    WHERE candidate_id=?
    ORDER BY line_no
  `).all(candidateId) as unknown as Array<{
    selectionCanonical: string | null;
    refundScope: string;
    refundYenPer100: number;
    reasonCode: string;
  }>).map((row) => [row.selectionCanonical, row.refundScope, row.refundYenPer100, row.reasonCode]);

  return canonicalHash({
    betType: candidate.betType,
    settlementStatus: candidate.settlementStatus,
    resultKind: candidate.resultKind,
    payouts,
    refunds,
  }) === candidate.semanticHash;
}

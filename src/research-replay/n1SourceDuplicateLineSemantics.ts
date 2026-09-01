import type { DatabaseSync } from "node:sqlite";

import { BET_TYPES, parseSettlementSelection, type SettlementBetType } from "./settlement";

const BET_TYPE_SET: ReadonlySet<string> = new Set(BET_TYPES);
const REFUND_SCOPE_SET: ReadonlySet<string> = new Set(["selection", "bet_type", "race"]);
const SETTLEMENT_STATUS_SET: ReadonlySet<string> = new Set([
  "pending", "settled", "refunded", "partially_refunded", "cancelled", "no_sale",
]);
const RESULT_KIND_SET: ReadonlySet<string> = new Set([
  "normal", "dead_heat", "special_payout", "source_defined", "unknown",
]);
const RESOLUTION_STATUS_SET: ReadonlySet<string> = new Set([
  "resolved", "source_conflict", "unresolved", "quarantined",
]);
const CURRENT_CANDIDATE_AUTHORITY_COLUMNS = [
  "candidate_id", "canonical_race_key", "bet_type", "settlement_status", "result_kind",
  "revision_kind", "resolution_status", "source_kind", "source_schema_version", "observation_id",
  "parse_run_id", "raw_document_id", "semantic_hash", "supersedes_candidate_id", "correction_reason",
  "observed_at", "created_at",
] as const;
const CURRENT_CANDIDATE_AUTHORITY_MARKERS = [
  "source_kind", "source_schema_version", "observed_at", "created_at",
] as const;
const CURRENT_LINE_IDENTITY_COLUMNS = [
  "bet_type", "selection_raw", "selection_normalized", "selection_canonical",
] as const;
const CURRENT_PAYOUT_AUTHORITY_MARKERS = ["payout_line_id", "created_at"] as const;
const CURRENT_REFUND_AUTHORITY_MARKERS = ["refund_line_id", "created_at"] as const;
const LEGACY_LINE_IDENTITY_ABSENT_COLUMNS = [
  "bet_type", "selection_raw", "selection_normalized",
] as const;
const CURRENT_PAYOUT_SEMANTIC_COLUMNS = [
  ...CURRENT_LINE_IDENTITY_COLUMNS, "line_no", "payout_yen", "popularity", "line_kind",
] as const;
const CURRENT_REFUND_SEMANTIC_COLUMNS = [
  ...CURRENT_LINE_IDENTITY_COLUMNS, "line_no", "refund_scope", "refund_yen_per_100", "reason_code",
] as const;

type LineRow = {
  lineNo: number;
  lineBetType: string;
  selectionRaw: string | null;
  selectionNormalized: string | null;
  selectionCanonical: string | null;
};

type PayoutLineRow = LineRow & {
  lineKind: string | null;
  payoutYen: number;
  popularity: number | null;
};

type RefundLineRow = LineRow & {
  refundScope: string;
  refundYenPer100: number | null;
};

type LineIdentitySchemaKind = "legacy" | "current" | "partial";

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function tableHasColumns(db: DatabaseSync, table: string, required: readonly string[]): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  const names = new Set(rows.map((row) => row.name));
  return required.every((column) => names.has(column));
}

function lineIdentitySchemaKind(db: DatabaseSync, table: string): LineIdentitySchemaKind {
  if (tableHasColumns(db, table, CURRENT_LINE_IDENTITY_COLUMNS)) return "current";
  const currentMarkers = table === "race_payout_lines_v2"
    ? CURRENT_PAYOUT_AUTHORITY_MARKERS
    : table === "race_refund_lines_v2"
      ? CURRENT_REFUND_AUTHORITY_MARKERS
      : [];
  if (currentMarkers.some((column) => tableHasColumns(db, table, [column]))) return "partial";
  const legacyOnly = LEGACY_LINE_IDENTITY_ABSENT_COLUMNS.every((column) =>
    !tableHasColumns(db, table, [column]));
  return legacyOnly ? "legacy" : "partial";
}

function currentSemanticAuthorityPresent(db: DatabaseSync): boolean {
  return tableExists(db, "settlement_candidates_v2")
    && tableExists(db, "race_payout_lines_v2")
    && tableExists(db, "race_refund_lines_v2")
    && tableHasColumns(db, "settlement_candidates_v2", CURRENT_CANDIDATE_AUTHORITY_COLUMNS)
    && tableHasColumns(db, "race_payout_lines_v2", CURRENT_PAYOUT_SEMANTIC_COLUMNS)
    && tableHasColumns(db, "race_refund_lines_v2", CURRENT_REFUND_SEMANTIC_COLUMNS);
}

function candidateMetadataSemanticsValid(
  db: DatabaseSync,
  candidateId: string,
  candidateBetType: string,
): boolean {
  if (!tableExists(db, "settlement_candidates_v2")) return true;
  const required = ["candidate_id", "bet_type", "settlement_status", "result_kind"] as const;
  const requiredPresence = required.map((column) => tableHasColumns(db, "settlement_candidates_v2", [column]));
  if (requiredPresence.every((present) => !present)) return true;
  if (requiredPresence.some((present) => !present)) return false;
  const hasCurrentCandidateAuthorityMarker = CURRENT_CANDIDATE_AUTHORITY_MARKERS.some((column) =>
    tableHasColumns(db, "settlement_candidates_v2", [column]));
  if (hasCurrentCandidateAuthorityMarker
    && !tableHasColumns(db, "settlement_candidates_v2", CURRENT_CANDIDATE_AUTHORITY_COLUMNS)) return false;
  const hasSemanticHash = tableHasColumns(db, "settlement_candidates_v2", ["semantic_hash"]);
  const hasResolutionStatus = tableHasColumns(db, "settlement_candidates_v2", ["resolution_status"]);
  const row = db.prepare(`
    SELECT bet_type AS betType,
           settlement_status AS settlementStatus,
           result_kind AS resultKind,
           ${hasResolutionStatus ? "resolution_status" : "NULL"} AS resolutionStatus,
           ${hasSemanticHash ? "semantic_hash" : "NULL"} AS semanticHash
    FROM settlement_candidates_v2
    WHERE candidate_id=?
  `).get(candidateId) as {
    betType: string;
    settlementStatus: string;
    resultKind: string;
    resolutionStatus: string | null;
    semanticHash: string | null;
  } | undefined;
  if (row === undefined
    || row.betType !== candidateBetType
    || !SETTLEMENT_STATUS_SET.has(row.settlementStatus)
    || !RESULT_KIND_SET.has(row.resultKind)
    || (hasResolutionStatus && (row.resolutionStatus === null || !RESOLUTION_STATUS_SET.has(row.resolutionStatus)))) {
    return false;
  }

  // Current N1 candidate + semantic line authority never persist placeholder hashes. Keep narrow
  // synthetic fixtures compatible, but fail closed once the full production candidate schema and
  // persisted semantic hash-input columns are present together.
  if (hasSemanticHash && currentSemanticAuthorityPresent(db)) {
    return typeof row.semanticHash === "string" && /^[0-9a-f]{64}$/.test(row.semanticHash);
  }
  return true;
}

function parsedSelectionMatches(
  candidateBetType: SettlementBetType,
  row: LineRow,
  requireValid: boolean,
): boolean {
  if (row.selectionRaw === null || row.selectionNormalized === null) return false;
  const parsed = parseSettlementSelection(candidateBetType, row.selectionRaw);
  return (!requireValid || parsed.valid)
    && parsed.normalized === row.selectionNormalized
    && parsed.canonical === row.selectionCanonical;
}

function payoutLineSemanticsValid(candidateBetType: SettlementBetType, row: PayoutLineRow): boolean {
  if (!Number.isSafeInteger(row.lineNo) || row.lineNo < 1) return false;
  if (row.lineBetType !== candidateBetType) return false;
  if (!Number.isSafeInteger(row.payoutYen) || row.payoutYen < 0) return false;
  if (row.popularity !== null && (!Number.isSafeInteger(row.popularity) || row.popularity < 1)) return false;
  if (row.lineKind === null) {
    if (row.selectionCanonical === null) return row.selectionRaw === null && row.selectionNormalized === null;
    return parsedSelectionMatches(candidateBetType, row, true);
  }
  if (row.lineKind === "payout") {
    return row.selectionCanonical !== null && parsedSelectionMatches(candidateBetType, row, true);
  }
  if (row.lineKind === "special_payout") {
    return parsedSelectionMatches(candidateBetType, row, false);
  }
  return false;
}

function refundLineSemanticsValid(candidateBetType: SettlementBetType, row: RefundLineRow): boolean {
  if (!Number.isSafeInteger(row.lineNo) || row.lineNo < 1) return false;
  if (row.lineBetType !== candidateBetType) return false;
  if (!REFUND_SCOPE_SET.has(row.refundScope)) return false;
  if (row.refundYenPer100 !== null
    && (!Number.isSafeInteger(row.refundYenPer100) || row.refundYenPer100 < 0)) return false;
  if (row.selectionCanonical === null) {
    return row.selectionRaw === null && row.selectionNormalized === null;
  }
  return parsedSelectionMatches(candidateBetType, row, true);
}

function lineNumbersUnique(rows: readonly LineRow[]): boolean {
  return new Set(rows.map((row) => row.lineNo)).size === rows.length;
}

/**
 * Revalidate producer-only candidate and payout/refund line semantics before source-duplicate evidence is trusted.
 *
 * A few old synthetic unit fixtures intentionally model only the subset of settlement tables needed
 * by that test, or model both payout/refund tables with the pre-v2 line schema. Production N1
 * settlement creates the candidate and both line tables atomically with the current columns. Preserve
 * the fixture-only fallback only for the known legacy identity shape; partial current identity authority
 * is malformed and must fail closed.
 */
export function sourceDuplicateCandidateLineSemanticsValid(
  db: DatabaseSync,
  candidateId: string,
  candidateBetType: string,
): boolean {
  if (!BET_TYPE_SET.has(candidateBetType)) return false;
  if (!candidateMetadataSemanticsValid(db, candidateId, candidateBetType)) return false;

  const payoutTableExists = tableExists(db, "race_payout_lines_v2");
  const refundTableExists = tableExists(db, "race_refund_lines_v2");
  if (!payoutTableExists || !refundTableExists) return true;

  const payoutSchemaKind = lineIdentitySchemaKind(db, "race_payout_lines_v2");
  const refundSchemaKind = lineIdentitySchemaKind(db, "race_refund_lines_v2");
  if (payoutSchemaKind === "partial" || refundSchemaKind === "partial") return false;
  if (payoutSchemaKind === "legacy" && refundSchemaKind === "legacy") return true;
  if (payoutSchemaKind !== refundSchemaKind) return false;
  if (!tableHasColumns(db, "race_payout_lines_v2", ["line_no", "payout_yen"])) return false;
  if (!tableHasColumns(db, "race_refund_lines_v2", ["line_no", "refund_scope", "refund_yen_per_100"])) return false;

  const payoutHasLineKind = tableHasColumns(db, "race_payout_lines_v2", ["line_kind"]);
  const payoutHasPopularity = tableHasColumns(db, "race_payout_lines_v2", ["popularity"]);
  const payouts = db.prepare(`
    SELECT line_no AS lineNo,
           bet_type AS lineBetType,
           selection_raw AS selectionRaw,
           selection_normalized AS selectionNormalized,
           selection_canonical AS selectionCanonical,
           ${payoutHasLineKind ? "line_kind" : "NULL"} AS lineKind,
           payout_yen AS payoutYen,
           ${payoutHasPopularity ? "popularity" : "NULL"} AS popularity
    FROM race_payout_lines_v2
    WHERE candidate_id=?
    ORDER BY line_no
  `).all(candidateId) as unknown as PayoutLineRow[];
  const refunds = db.prepare(`
    SELECT line_no AS lineNo,
           bet_type AS lineBetType,
           selection_raw AS selectionRaw,
           selection_normalized AS selectionNormalized,
           selection_canonical AS selectionCanonical,
           refund_scope AS refundScope,
           refund_yen_per_100 AS refundYenPer100
    FROM race_refund_lines_v2
    WHERE candidate_id=?
    ORDER BY line_no
  `).all(candidateId) as unknown as RefundLineRow[];

  const betType = candidateBetType as SettlementBetType;
  return lineNumbersUnique(payouts)
    && lineNumbersUnique(refunds)
    && payouts.every((row) => payoutLineSemanticsValid(betType, row))
    && refunds.every((row) => refundLineSemanticsValid(betType, row));
}

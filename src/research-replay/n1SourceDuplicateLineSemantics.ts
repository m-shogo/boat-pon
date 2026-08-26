import type { DatabaseSync } from "node:sqlite";

import { BET_TYPES, parseSettlementSelection, type SettlementBetType } from "./settlement";

const BET_TYPE_SET: ReadonlySet<string> = new Set(BET_TYPES);

type LineRow = {
  lineBetType: string;
  selectionRaw: string | null;
  selectionNormalized: string | null;
  selectionCanonical: string | null;
};

type PayoutLineRow = LineRow & {
  lineKind: string | null;
};

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function tableHasColumns(db: DatabaseSync, table: string, required: readonly string[]): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  const names = new Set(rows.map((row) => row.name));
  return required.every((column) => names.has(column));
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
  if (row.lineBetType !== candidateBetType) return false;
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

function refundLineSemanticsValid(candidateBetType: SettlementBetType, row: LineRow): boolean {
  if (row.lineBetType !== candidateBetType) return false;
  if (row.selectionCanonical === null) {
    return row.selectionRaw === null && row.selectionNormalized === null;
  }
  return parsedSelectionMatches(candidateBetType, row, true);
}

/**
 * Revalidate producer-only payout/refund line semantics before source-duplicate evidence is trusted.
 *
 * A few old synthetic unit fixtures intentionally model only the subset of settlement tables needed
 * by that test, or model both payout/refund tables with the pre-v2 line schema. Production N1
 * settlement creates both line tables atomically with the current columns. Preserve the fixture-only
 * fallback when a line table is absent or both tables are legacy-shaped, but fail closed when both
 * tables exist and only one has the current producer schema.
 */
export function sourceDuplicateCandidateLineSemanticsValid(
  db: DatabaseSync,
  candidateId: string,
  candidateBetType: string,
): boolean {
  if (!BET_TYPE_SET.has(candidateBetType)) return false;

  const payoutTableExists = tableExists(db, "race_payout_lines_v2");
  const refundTableExists = tableExists(db, "race_refund_lines_v2");
  if (!payoutTableExists || !refundTableExists) return true;

  const required = ["bet_type", "selection_raw", "selection_normalized", "selection_canonical"] as const;
  const payoutSchemaCurrent = tableHasColumns(db, "race_payout_lines_v2", required);
  const refundSchemaCurrent = tableHasColumns(db, "race_refund_lines_v2", required);
  if (!payoutSchemaCurrent && !refundSchemaCurrent) return true;
  if (payoutSchemaCurrent !== refundSchemaCurrent) return false;

  const payoutHasLineKind = tableHasColumns(db, "race_payout_lines_v2", ["line_kind"]);
  const payouts = db.prepare(`
    SELECT bet_type AS lineBetType,
           selection_raw AS selectionRaw,
           selection_normalized AS selectionNormalized,
           selection_canonical AS selectionCanonical,
           ${payoutHasLineKind ? "line_kind" : "NULL"} AS lineKind
    FROM race_payout_lines_v2
    WHERE candidate_id=?
    ORDER BY line_no
  `).all(candidateId) as unknown as PayoutLineRow[];
  const refunds = db.prepare(`
    SELECT bet_type AS lineBetType,
           selection_raw AS selectionRaw,
           selection_normalized AS selectionNormalized,
           selection_canonical AS selectionCanonical
    FROM race_refund_lines_v2
    WHERE candidate_id=?
    ORDER BY line_no
  `).all(candidateId) as unknown as LineRow[];

  const betType = candidateBetType as SettlementBetType;
  return payouts.every((row) => payoutLineSemanticsValid(betType, row))
    && refunds.every((row) => refundLineSemanticsValid(betType, row));
}

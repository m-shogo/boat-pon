import { DatabaseSync } from "node:sqlite";

import { parseCanonicalRaceKey } from "./identity";
import {
  buildN2SelectionProfile,
  type N2PayoutLineInput,
  type N2RefundLineInput,
  type N2SelectionProfile,
  type N2SelectionProfileCandidate,
} from "./n2SelectionProfile";
import { readCurrentlyValidSourceDuplicateObservationIds } from "./n1SourceDuplicateResolutionValidation";
import {
  BET_TYPES,
  parseSettlementSelection,
  type ResolutionStatus,
  type SettlementBetType,
  type SettlementStatus,
} from "./settlement";

const REUSABLE_PARSE_STATUSES = new Set(["success", "warning"]);
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/u;
const BET_TYPE_SET: ReadonlySet<string> = new Set(BET_TYPES);
const SETTLEMENT_STATUS_SET: ReadonlySet<string> = new Set([
  "pending", "settled", "refunded", "partially_refunded", "cancelled", "no_sale",
]);
const RESOLUTION_STATUS_SET: ReadonlySet<string> = new Set([
  "resolved", "source_conflict", "unresolved", "quarantined",
]);

type CandidateRow = {
  id: string;
  observationId: string;
  raceKey: string;
  betType: string;
  settlementStatus: string;
  resolutionStatus: string;
  candidateParseRunId: string;
  candidateRawDocumentId: string;
  observationRaceKey: string | null;
  observationType: string | null;
  observationPayloadType: string | null;
  observationParseRunId: string | null;
  observationRawDocumentId: string | null;
  parseRunRawDocumentId: string | null;
  parseRunStatus: string | null;
  rawIntegrityStatus: string | null;
  rawSecurityScanStatus: string | null;
  rawParserReplayEligible: number | null;
};

type ValidCandidateRow = Omit<CandidateRow, "betType" | "settlementStatus" | "resolutionStatus"> & {
  betType: SettlementBetType;
  settlementStatus: SettlementStatus;
  resolutionStatus: ResolutionStatus;
};

type PayoutRow = {
  candidateId: string;
  candidateBetType: SettlementBetType;
  lineBetType: SettlementBetType;
  selectionRaw: string | null;
  selectionNormalized: string | null;
  selection: string | null;
  payoutYen: number;
  lineKind: string;
};

type RefundRow = {
  candidateId: string;
  candidateBetType: SettlementBetType;
  lineBetType: SettlementBetType;
  selectionRaw: string | null;
  selectionNormalized: string | null;
  selection: string | null;
  scope: string;
  refundYenPer100: number | null;
};

function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function requireSourceTables(db: DatabaseSync): void {
  for (const table of [
    "domain_observations",
    "parse_runs",
    "raw_documents",
    "settlement_candidates_v2",
    "race_payout_lines_v2",
    "race_refund_lines_v2",
    "settlement_source_duplicate_resolutions_v2",
  ]) {
    if (!tableExists(db, table)) throw new Error(`N2_SELECTION_PROFILE_TABLE_MISSING:${table}`);
  }
}

function isLabelBearing(row: ValidCandidateRow & { duplicate: number }): boolean {
  return row.duplicate === 0
    && row.settlementStatus === "settled"
    && row.resolutionStatus === "resolved";
}

function requireEligibleSettlementLineage(row: ValidCandidateRow & { duplicate: number }): void {
  if (!isLabelBearing(row)) return;
  if (row.observationRaceKey !== row.raceKey
    || row.observationType !== "settlement_result"
    || row.observationPayloadType !== "settlement_result"
    || row.observationParseRunId !== row.candidateParseRunId
    || row.observationRawDocumentId !== row.candidateRawDocumentId
    || row.parseRunRawDocumentId !== row.candidateRawDocumentId
    || row.parseRunStatus == null
    || !REUSABLE_PARSE_STATUSES.has(row.parseRunStatus)
    || row.rawIntegrityStatus !== "verified"
    || row.rawSecurityScanStatus !== "passed"
    || row.rawParserReplayEligible !== 1) {
    throw new Error(`N2_SELECTION_PROFILE_SETTLEMENT_LINEAGE_INVALID:${row.id}`);
  }
}

function requireCanonicalSelection(
  candidateId: string,
  betType: SettlementBetType,
  selection: string | null,
  errorCode: "PAYOUT" | "REFUND",
): void {
  if (selection === null) return;
  const parsed = parseSettlementSelection(betType, selection);
  if (!parsed.valid || parsed.canonical !== selection) {
    throw new Error(`N2_SELECTION_PROFILE_${errorCode}_SELECTION_INVALID:${candidateId}`);
  }
}

function requireSelectionSemantics(
  candidateId: string,
  betType: SettlementBetType,
  selectionRaw: string | null,
  selectionNormalized: string | null,
  selection: string | null,
  errorCode: "PAYOUT" | "REFUND",
): void {
  if (selection === null) return;
  if (selectionRaw === null || selectionNormalized === null) {
    throw new Error(`N2_SELECTION_PROFILE_${errorCode}_SELECTION_SEMANTICS_INVALID:${candidateId}`);
  }
  const parsed = parseSettlementSelection(betType, selectionRaw);
  if (!parsed.valid
    || parsed.normalized !== selectionNormalized
    || parsed.canonical !== selection) {
    throw new Error(`N2_SELECTION_PROFILE_${errorCode}_SELECTION_SEMANTICS_INVALID:${candidateId}`);
  }
}

function requireNonNegativeSafeAmount(
  candidateId: string,
  value: number | null,
  errorCode: "PAYOUT" | "REFUND",
): void {
  if (value === null && errorCode === "REFUND") return;
  if (!Number.isSafeInteger(value) || (value ?? -1) < 0) {
    throw new Error(`N2_SELECTION_PROFILE_${errorCode}_AMOUNT_INVALID:${candidateId}`);
  }
}

function requirePayoutLineKind(
  candidateId: string,
  lineKind: string,
): asserts lineKind is N2PayoutLineInput["lineKind"] {
  if (lineKind !== "payout" && lineKind !== "special_payout") {
    throw new Error(`N2_SELECTION_PROFILE_PAYOUT_LINE_KIND_INVALID:${candidateId}`);
  }
}

function requireRefundScope(
  candidateId: string,
  scope: string,
): asserts scope is N2RefundLineInput["scope"] {
  if (scope !== "selection" && scope !== "bet_type" && scope !== "race") {
    throw new Error(`N2_SELECTION_PROFILE_REFUND_SCOPE_INVALID:${candidateId}`);
  }
}

function requireCanonicalRaceIdentity(row: CandidateRow): void {
  try {
    parseCanonicalRaceKey(row.raceKey);
  } catch {
    throw new Error(`N2_SELECTION_PROFILE_RACE_KEY_INVALID:${row.id}`);
  }
}

function requireCandidateSemantics(row: CandidateRow): ValidCandidateRow {
  if (!BET_TYPE_SET.has(row.betType)) {
    throw new Error(`N2_SELECTION_PROFILE_BET_TYPE_INVALID:${row.id}`);
  }
  if (!SETTLEMENT_STATUS_SET.has(row.settlementStatus)) {
    throw new Error(`N2_SELECTION_PROFILE_SETTLEMENT_STATUS_INVALID:${row.id}`);
  }
  if (!RESOLUTION_STATUS_SET.has(row.resolutionStatus)) {
    throw new Error(`N2_SELECTION_PROFILE_RESOLUTION_STATUS_INVALID:${row.id}`);
  }
  return row as ValidCandidateRow;
}

function requireSupersessionIdentity(db: DatabaseSync, lower: string, upper: string): void {
  const invalid = db.prepare(`
    SELECT newer.candidate_id AS candidateId
    FROM settlement_candidates_v2 newer
    JOIN settlement_candidates_v2 prior
      ON prior.candidate_id = newer.supersedes_candidate_id
    WHERE (
        (prior.canonical_race_key >= ? AND prior.canonical_race_key < ?)
        OR (newer.canonical_race_key >= ? AND newer.canonical_race_key < ?)
      )
      AND (newer.canonical_race_key <> prior.canonical_race_key OR newer.bet_type <> prior.bet_type)
    ORDER BY newer.candidate_id
    LIMIT 1
  `).get(lower, upper, lower, upper) as { candidateId: string } | undefined;
  if (invalid) {
    throw new Error(`N2_SELECTION_PROFILE_SUPERSESSION_IDENTITY_INVALID:${invalid.candidateId}`);
  }
}

function requireSupersessionStructure(db: DatabaseSync, lower: string, upper: string): void {
  const missingPredecessor = db.prepare(`
    SELECT newer.candidate_id AS candidateId
    FROM settlement_candidates_v2 newer
    WHERE newer.canonical_race_key >= ? AND newer.canonical_race_key < ?
      AND newer.supersedes_candidate_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM settlement_candidates_v2 prior
        WHERE prior.candidate_id = newer.supersedes_candidate_id
      )
    ORDER BY newer.candidate_id
    LIMIT 1
  `).get(lower, upper) as { candidateId: string } | undefined;
  if (missingPredecessor) {
    throw new Error(`N2_SELECTION_PROFILE_SUPERSESSION_PREDECESSOR_MISSING:${missingPredecessor.candidateId}`);
  }

  const cycle = db.prepare(`
    WITH RECURSIVE chain(rootCandidateId,currentCandidateId,nextCandidateId,depth) AS (
      SELECT candidate_id,candidate_id,supersedes_candidate_id,0
      FROM settlement_candidates_v2
      WHERE canonical_race_key >= ? AND canonical_race_key < ?
      UNION ALL
      SELECT chain.rootCandidateId,prior.candidate_id,prior.supersedes_candidate_id,chain.depth+1
      FROM chain
      JOIN settlement_candidates_v2 prior ON prior.candidate_id=chain.nextCandidateId
      WHERE chain.nextCandidateId IS NOT NULL
        AND chain.depth < 1024
    )
    SELECT rootCandidateId AS candidateId
    FROM chain
    WHERE nextCandidateId=rootCandidateId
    ORDER BY candidateId
    LIMIT 1
  `).get(lower, upper) as { candidateId: string } | undefined;
  if (cycle) {
    throw new Error(`N2_SELECTION_PROFILE_SUPERSESSION_CYCLE_INVALID:${cycle.candidateId}`);
  }
}

export function readN2SelectionProfileSource(
  db: DatabaseSync,
  month: string,
): N2SelectionProfile {
  if (!MONTH_RE.test(month)) throw new Error(`N2_SELECTION_PROFILE_MONTH_INVALID:${month}`);
  requireSourceTables(db);

  const validResolvedObservationIds = readCurrentlyValidSourceDuplicateObservationIds(db);
  const lower = `${month}-01`;
  const upper = `${month}-99`;
  requireSupersessionIdentity(db, lower, upper);
  requireSupersessionStructure(db, lower, upper);
  const candidateRows = db.prepare(`
    SELECT c.candidate_id id,
           c.observation_id observationId,
           c.canonical_race_key raceKey,
           c.bet_type betType,
           c.settlement_status settlementStatus,
           c.resolution_status resolutionStatus,
           c.parse_run_id candidateParseRunId,
           c.raw_document_id candidateRawDocumentId,
           o.canonical_race_key observationRaceKey,
           o.observation_type observationType,
           o.payload_type observationPayloadType,
           o.parse_run_id observationParseRunId,
           o.raw_document_id observationRawDocumentId,
           pr.raw_document_id parseRunRawDocumentId,
           pr.status parseRunStatus,
           rd.integrity_status rawIntegrityStatus,
           rd.security_scan_status rawSecurityScanStatus,
           rd.parser_replay_eligible rawParserReplayEligible
    FROM settlement_candidates_v2 c
    LEFT JOIN domain_observations o
      ON o.observation_id = c.observation_id
    LEFT JOIN parse_runs pr
      ON pr.parse_run_id = c.parse_run_id
    LEFT JOIN raw_documents rd
      ON rd.raw_document_id = c.raw_document_id
    WHERE c.canonical_race_key >= ? AND c.canonical_race_key < ?
      AND NOT EXISTS (
        SELECT 1 FROM settlement_candidates_v2 newer
        WHERE newer.supersedes_candidate_id = c.candidate_id
      )
    ORDER BY c.canonical_race_key, c.bet_type, c.candidate_id
  `).all(lower, upper) as unknown as CandidateRow[];
  const validatedRows = candidateRows.map((row) => {
    requireCanonicalRaceIdentity(row);
    return requireCandidateSemantics(row);
  });
  const candidates = validatedRows.map((row) => ({
    ...row,
    duplicate: validResolvedObservationIds.has(row.observationId) ? 1 : 0,
  }));

  for (const candidate of candidates) requireEligibleSettlementLineage(candidate);

  const payouts = db.prepare(`
    SELECT p.candidate_id candidateId,
           c.bet_type candidateBetType,
           p.bet_type lineBetType,
           p.selection_raw selectionRaw,
           p.selection_normalized selectionNormalized,
           p.selection_canonical selection,
           p.payout_yen payoutYen,
           p.line_kind lineKind
    FROM race_payout_lines_v2 p
    JOIN settlement_candidates_v2 c ON c.candidate_id = p.candidate_id
    WHERE c.canonical_race_key >= ? AND c.canonical_race_key < ?
      AND NOT EXISTS (
        SELECT 1 FROM settlement_candidates_v2 newer
        WHERE newer.supersedes_candidate_id = c.candidate_id
      )
    ORDER BY c.canonical_race_key, c.bet_type, c.candidate_id, p.line_no
  `).all(lower, upper) as unknown as PayoutRow[];

  const refunds = db.prepare(`
    SELECT f.candidate_id candidateId,
           c.bet_type candidateBetType,
           f.bet_type lineBetType,
           f.selection_raw selectionRaw,
           f.selection_normalized selectionNormalized,
           f.selection_canonical selection,
           f.refund_scope scope,
           f.refund_yen_per_100 refundYenPer100
    FROM race_refund_lines_v2 f
    JOIN settlement_candidates_v2 c ON c.candidate_id = f.candidate_id
    WHERE c.canonical_race_key >= ? AND c.canonical_race_key < ?
      AND NOT EXISTS (
        SELECT 1 FROM settlement_candidates_v2 newer
        WHERE newer.supersedes_candidate_id = c.candidate_id
      )
    ORDER BY c.canonical_race_key, c.bet_type, c.candidate_id, f.line_no
  `).all(lower, upper) as unknown as RefundRow[];

  const payoutsByCandidate = new Map<string, N2PayoutLineInput[]>();
  for (const row of payouts) {
    if (row.lineBetType !== row.candidateBetType) {
      throw new Error(`N2_SELECTION_PROFILE_PAYOUT_BET_LINEAGE_INVALID:${row.candidateId}`);
    }
    requirePayoutLineKind(row.candidateId, row.lineKind);
    requireCanonicalSelection(row.candidateId, row.candidateBetType, row.selection, "PAYOUT");
    requireSelectionSemantics(
      row.candidateId,
      row.candidateBetType,
      row.selectionRaw,
      row.selectionNormalized,
      row.selection,
      "PAYOUT",
    );
    requireNonNegativeSafeAmount(row.candidateId, row.payoutYen, "PAYOUT");
    const lines = payoutsByCandidate.get(row.candidateId) ?? [];
    lines.push({ selection: row.selection, payoutYen: row.payoutYen, lineKind: row.lineKind });
    payoutsByCandidate.set(row.candidateId, lines);
  }
  const refundsByCandidate = new Map<string, N2RefundLineInput[]>();
  for (const row of refunds) {
    if (row.lineBetType !== row.candidateBetType) {
      throw new Error(`N2_SELECTION_PROFILE_REFUND_BET_LINEAGE_INVALID:${row.candidateId}`);
    }
    requireRefundScope(row.candidateId, row.scope);
    requireCanonicalSelection(row.candidateId, row.candidateBetType, row.selection, "REFUND");
    requireSelectionSemantics(
      row.candidateId,
      row.candidateBetType,
      row.selectionRaw,
      row.selectionNormalized,
      row.selection,
      "REFUND",
    );
    requireNonNegativeSafeAmount(row.candidateId, row.refundYenPer100, "REFUND");
    const lines = refundsByCandidate.get(row.candidateId) ?? [];
    lines.push({
      selection: row.selection,
      scope: row.scope,
      refundYenPer100: row.refundYenPer100,
    });
    refundsByCandidate.set(row.candidateId, lines);
  }

  const input: N2SelectionProfileCandidate[] = candidates.map((row) => ({
    candidateId: row.id,
    canonicalRaceKey: row.raceKey,
    betType: row.betType,
    settlementStatus: row.settlementStatus,
    resolutionStatus: row.resolutionStatus,
    isSourceDuplicate: row.duplicate === 1,
    payouts: payoutsByCandidate.get(row.id) ?? [],
    refunds: refundsByCandidate.get(row.id) ?? [],
  }));
  return buildN2SelectionProfile(input);
}

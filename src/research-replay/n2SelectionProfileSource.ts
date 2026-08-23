import { DatabaseSync } from "node:sqlite";

import {
  buildN2SelectionProfile,
  type N2PayoutLineInput,
  type N2RefundLineInput,
  type N2SelectionProfile,
  type N2SelectionProfileCandidate,
} from "./n2SelectionProfile";
import type {
  ResolutionStatus,
  SettlementBetType,
  SettlementStatus,
} from "./settlement";

const REUSABLE_PARSE_STATUSES = new Set(["success", "warning"]);
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/u;

type CandidateRow = {
  id: string;
  raceKey: string;
  betType: SettlementBetType;
  settlementStatus: SettlementStatus;
  resolutionStatus: ResolutionStatus;
  duplicate: number;
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

type PayoutRow = {
  candidateId: string;
  candidateBetType: SettlementBetType;
  lineBetType: SettlementBetType;
  selection: string | null;
  payoutYen: number;
  lineKind: "payout" | "special_payout";
};

type RefundRow = {
  candidateId: string;
  candidateBetType: SettlementBetType;
  lineBetType: SettlementBetType;
  selection: string | null;
  scope: "selection" | "bet_type" | "race";
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

function isLabelBearing(row: CandidateRow): boolean {
  return row.duplicate === 0
    && row.settlementStatus === "settled"
    && row.resolutionStatus === "resolved";
}

function requireEligibleSettlementLineage(row: CandidateRow): void {
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

export function readN2SelectionProfileSource(
  db: DatabaseSync,
  month: string,
): N2SelectionProfile {
  if (!MONTH_RE.test(month)) throw new Error(`N2_SELECTION_PROFILE_MONTH_INVALID:${month}`);
  requireSourceTables(db);

  const lower = `${month}-01`;
  const upper = `${month}-99`;
  const candidates = db.prepare(`
    SELECT c.candidate_id id,
           c.canonical_race_key raceKey,
           c.bet_type betType,
           c.settlement_status settlementStatus,
           c.resolution_status resolutionStatus,
           CASE WHEN d.duplicate_observation_id IS NULL THEN 0 ELSE 1 END duplicate,
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
    LEFT JOIN settlement_source_duplicate_resolutions_v2 d
      ON d.duplicate_observation_id = c.observation_id
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

  for (const candidate of candidates) requireEligibleSettlementLineage(candidate);

  const payouts = db.prepare(`
    SELECT p.candidate_id candidateId,
           c.bet_type candidateBetType,
           p.bet_type lineBetType,
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
    const lines = payoutsByCandidate.get(row.candidateId) ?? [];
    lines.push({ selection: row.selection, payoutYen: row.payoutYen, lineKind: row.lineKind });
    payoutsByCandidate.set(row.candidateId, lines);
  }
  const refundsByCandidate = new Map<string, N2RefundLineInput[]>();
  for (const row of refunds) {
    if (row.lineBetType !== row.candidateBetType) {
      throw new Error(`N2_SELECTION_PROFILE_REFUND_BET_LINEAGE_INVALID:${row.candidateId}`);
    }
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

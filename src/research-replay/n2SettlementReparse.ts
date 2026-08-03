// N2 settlement reparse / supersession core（append-only, deterministic, pure）。
//
// 目的: 永続 sidecar に backfill 済みの v1 parser 由来 settlement candidate のうち、
// 「特払い」を race-wide 返還として誤分類した v1 defect（V1_SPECIAL_PAYOUT_FALSE_REFUND）を、
// v2 parser 再parse 結果へ append-only supersession で訂正する。既存 row は UPDATE/DELETE しない。
//
// 本モジュールは純粋関数のみ（DB/FS/archive I/O を持たない）。archive 解凍・sidecar copy・
// candidate append は CLI（scripts/reparse-settlement-v2.ts）が担う。訂正対象は「証拠により
// v1 defect と確定できる candidate」だけに限定し、曖昧な差分は訂正せず skip する。
import type { ParsedResultDetail, RacePayout } from "../domain/officialResultDetailParser";
import { classifyRaceLines, resolveStatus, VENUE_CODES } from "./n1Backfill";
import { BET_TYPES, type ResultKind, type SettlementBetType, type SettlementStatus } from "./settlement";

// ---- fixed contract identities（暗黙 default を作らない）----
export const REPARSE_SCHEMA_VERSION = "n2-settlement-reparse-v1";
export const REPARSE_SOURCE_PARSER_VERSION = "n1-settlement-parser-v1"; // sidecar backfill の defect parser
export const REPARSE_TARGET_PARSER_VERSION = "n1-settlement-parser-v2"; // = N1_SETTLEMENT_PARSER_VERSION
export const REPARSE_CANONICALIZATION_VERSION = "rr-c14n-v1";
export const REPARSE_RACE_IDENTITY_VERSION = "race-identity-v1"; // `${date}:${venueCode}:R${raceNo}`
export const REPARSE_REPORT_SCHEMA_VERSION = "n2-settlement-reparse-report-v1";
export const REPARSE_PARSER_NAME = "n2-settlement-reparse";

// versioned enum。未知の訂正理由をこの code へ混ぜない。
export const PARSER_DEFECT_CODES = ["V1_SPECIAL_PAYOUT_FALSE_REFUND"] as const;
export type ParserDefectCode = (typeof PARSER_DEFECT_CODES)[number];

export type ReparseAction =
  | "exact"                    // 既存 active と v2 が一致（no-op）
  | "false_refund_correction"  // 既存 refunded/partially_refunded → v2 settled（supersede）
  | "result_kind_correction"   // status 一致・result_kind が v2 special_payout へ変化（supersede）
  | "special_payout_addition"  // 既存 active なし・v2 special_payout（initial 追加）
  | "ambiguous_non_defect"     // 既存ありだが defect と確定できない差分（skip）
  | "unexpected_addition";     // 既存 active なし・v2 が special payout ではない（skip / flag）

export type DerivedPayoutLine = {
  selection: string;
  payoutYen: number;
  popularity: number | null;
  lineKind: "payout" | "special_payout";
};
export type DerivedRefundLine = {
  selection: string | null;
  scope: "selection" | "bet_type" | "race";
  refundYenPer100: number | null;
  reasonCode: string;
};

// v2 parser で再導出した canonical identity 付き settlement candidate（payout/refund line 付き）。
export type DerivedCandidate = {
  raceKey: string;
  betType: SettlementBetType;
  status: SettlementStatus;
  resultKind: ResultKind;
  payouts: DerivedPayoutLine[];
  refunds: DerivedRefundLine[];
};

// 既存 sidecar の active canonical candidate（CLI が temp copy から供給）。
export type ExistingActiveCandidate = {
  candidateId: string;
  status: SettlementStatus;
  resultKind: ResultKind;
  rawDocumentId: string;
  sourceSchemaVersion: string;
} | null;

const BET_TYPE_SET: ReadonlySet<string> = new Set(BET_TYPES);
const REFUND_STATUSES: ReadonlySet<SettlementStatus> = new Set(["refunded", "partially_refunded"]);

export function candidateKey(raceKey: string, betType: SettlementBetType): string {
  return `${raceKey} ${betType}`;
}

function resultKindOf(specialPayoutLines: number): ResultKind {
  return specialPayoutLines > 0 ? "special_payout" : "normal";
}

// ParsedResultDetail（v2）から payout/refund line 付き settlement candidate を導出する。
// n1Backfill の per-race 分類と同じ classifyRaceLines/resolveStatus を再利用し、二重正本を作らない。
// 未知 venue / 範囲外 raceNo は candidate を作らず除外（fail-closed）。
export function deriveSettlementCandidates(parsed: ParsedResultDetail): DerivedCandidate[] {
  const raceKeyById = new Map<string, string>();
  for (const condition of parsed.conditions) {
    const code = VENUE_CODES[condition.venue];
    if (!code || condition.raceNo < 1 || condition.raceNo > 12) continue;
    raceKeyById.set(condition.raceId, `${condition.date}:${code}:R${condition.raceNo}`);
  }

  const grouped = new Map<string, { raceKey: string; betType: SettlementBetType; lines: RacePayout[] }>();
  for (const line of parsed.payouts) {
    if (!BET_TYPE_SET.has(line.betType)) continue;
    const raceKey = raceKeyById.get(line.raceId);
    if (!raceKey) continue;
    const betType = line.betType as SettlementBetType;
    const key = candidateKey(raceKey, betType);
    const bucket = grouped.get(key);
    if (bucket) bucket.lines.push(line);
    else grouped.set(key, { raceKey, betType, lines: [line] });
  }

  const out: DerivedCandidate[] = [];
  for (const { raceKey, betType, lines } of grouped.values()) {
    const bucket = classifyRaceLines(betType, lines);
    const status = resolveStatus(bucket);
    if (!status) continue;
    const specialPayoutLines = bucket.payouts.filter((line) => line.lineKind === "special_payout").length;
    out.push({
      raceKey,
      betType,
      status,
      resultKind: resultKindOf(specialPayoutLines),
      payouts: bucket.payouts.map((line) => ({
        selection: line.selection,
        payoutYen: line.payoutYen,
        popularity: line.popularity ?? null,
        lineKind: line.lineKind,
      })),
      refunds: bucket.refunds.map((line) => ({
        selection: line.selection,
        scope: line.scope,
        refundYenPer100: line.refundYenPer100 ?? null,
        reasonCode: line.reasonCode,
      })),
    });
  }
  out.sort((left, right) =>
    left.raceKey.localeCompare(right.raceKey) || left.betType.localeCompare(right.betType));
  return out;
}

// 既存 active candidate と v2 candidate から reparse action を決定する。
// 訂正は V1_SPECIAL_PAYOUT_FALSE_REFUND defect と確定できる形（refunded→settled / result_kind→special_payout /
// special payout の欠落追加）に限定し、それ以外の差分は訂正しない（append-only, fail-closed）。
export function decideReparseAction(existing: ExistingActiveCandidate, v2: DerivedCandidate): ReparseAction {
  if (!existing) {
    return v2.resultKind === "special_payout" ? "special_payout_addition" : "unexpected_addition";
  }
  if (existing.status === v2.status && existing.resultKind === v2.resultKind) return "exact";
  if (REFUND_STATUSES.has(existing.status) && v2.status === "settled") return "false_refund_correction";
  if (existing.status === v2.status
    && existing.resultKind !== v2.resultKind
    && v2.resultKind === "special_payout") {
    return "result_kind_correction";
  }
  return "ambiguous_non_defect";
}

// ---- unexpected_addition / ambiguous 分類（versioned contract）----
export const ADDITION_CLASSIFICATIONS = [
  "CONFIRMED_MISSING_SPECIAL_PAYOUT",    // v1 が抑止した特払い（本 reparse が special_payout_addition として扱う）
  "CONFIRMED_V1_WIN_REFUND_OMISSION",    // v1 が win 返還 candidate を出さなかった別 defect（本 reparse scope 外）
  "CONFIRMED_V1_PARSER_DEFECT",          // その他の確定 v1 defect（別 scope）
  "CONFIRMED_BACKFILL_GAP",              // ingested raw に無い race（reparse scope 外）
  "CONFIRMED_SOURCE_DUPLICATE",          // candidate は在るが全て source_duplicate/superseded
  "CONFIRMED_IDENTITY_MISMATCH",         // canonical identity 不一致
  "CONFIRMED_NON_ACTIONABLE",            // 対応不要
  "MANUAL_REVIEW_REQUIRED",              // 人手判断が必要
  "UNKNOWN_BLOCKED",                     // 不明・fail-closed
] as const;
export type AdditionClassification = (typeof ADDITION_CLASSIFICATIONS)[number];

export type AdditionEvidence = {
  betType: SettlementBetType;
  v2Status: SettlementStatus;
  v2ResultKind: ResultKind;
  anyCandidateForRaceBet: boolean; // sidecar に当該 race+bet_type の candidate が存在するか
  anyActiveForRaceBet: boolean;    // うち active（非 source_dup・非 superseded）が存在するか
};
export type AdditionDecision = {
  classification: AdditionClassification;
  reason: string;
  autoApplyEligible: boolean; // 本 special-payout reparse で自動適用してよいか（unexpected は常に false）
};

// unexpected_addition を証拠から決定的に分類する。本 reparse（特払い false-refund 訂正）の
// scope 外事象は auto-apply しない。期待値合わせで強制訂正しない。
export function classifyUnexpectedAddition(ev: AdditionEvidence): AdditionDecision {
  if (!ev.anyCandidateForRaceBet) {
    if (ev.v2Status === "refunded" || ev.v2Status === "partially_refunded") {
      return {
        classification: "CONFIRMED_V1_WIN_REFUND_OMISSION",
        reason: "no v1 candidate exists for this race+bet_type and v2 derives a refunded candidate: a distinct v1 refund-omission defect, outside the V1_SPECIAL_PAYOUT_FALSE_REFUND reparse scope. Hold for a separately-approved correction.",
        autoApplyEligible: false,
      };
    }
    return {
      classification: "MANUAL_REVIEW_REQUIRED",
      reason: "no v1 candidate exists and v2 derives a non-special settled candidate; not the special-payout defect. Manual review before any separate correction.",
      autoApplyEligible: false,
    };
  }
  if (!ev.anyActiveForRaceBet) {
    return {
      classification: "CONFIRMED_SOURCE_DUPLICATE",
      reason: "v1 candidate(s) exist but all are source_duplicate/superseded (no active); v2-only appearance is a duplicate-resolution artifact, not a parser defect. Hold out.",
      autoApplyEligible: false,
    };
  }
  return {
    classification: "MANUAL_REVIEW_REQUIRED",
    reason: "active candidate exists yet the decision fell through to unexpected_addition; unexpected. Manual review.",
    autoApplyEligible: false,
  };
}

export function isSupersedingAction(action: ReparseAction): boolean {
  return action === "false_refund_correction" || action === "result_kind_correction";
}
export function isAppendingAction(action: ReparseAction): boolean {
  return isSupersedingAction(action) || action === "special_payout_addition";
}

export const REPARSE_ACTIONS: ReparseAction[] = [
  "exact", "false_refund_correction", "result_kind_correction",
  "special_payout_addition", "ambiguous_non_defect", "unexpected_addition",
];

// N2 archive↔canonical settlement reconciliation core（read-only, deterministic）。
//
// 目的: 実 K archive を現行 parser（v2）で再parseして導出した settlement candidate を、
// 永続 sidecar に backfill 済みの canonical active candidate（v1 由来）と
// canonical race identity で突合し、event/coverage class を fail-closed で分類する。
//
// 本モジュールは純粋関数のみ（DB/FS/archive I/O を持たない）。DB streaming と archive
// 解凍は CLI（scripts/reconcile-archive-canonical-settlement.ts）が担い、ここへ渡す。
// raw 本文・巨大 payload は保持しない。未知 bet type / 未知 status は明示的 unknown に落とす。
import type { ParsedResultDetail } from "../domain/officialResultDetailParser";
import { classifyRaceLines, resolveStatus, VENUE_CODES } from "./n1Backfill";
import { BET_TYPES, type SettlementBetType, type SettlementStatus } from "./settlement";

// ---- fixed contract identities（暗黙 default を作らない）----
export const RECONCILE_INPUT_VERSION = "n2-archive-canonical-reconcile-v1";
export const RACE_IDENTITY_VERSION = "race-identity-v1"; // `${date}:${venueCode}:R${raceNo}`
export const EVENT_CLASSIFICATION_VERSION = "refund-reconcile-events-v1";
export const REPORT_SCHEMA_VERSION = "n2-archive-canonical-reconcile-report-v1";
export const SETTLEMENT_CANONICALIZATION_VERSION = "n1-settlement-classify-v2";
export const EXPECTED_SETTLEMENT_SCHEMA_VERSION = "n1-settlement.0.3";

export type ResultKind =
  | "normal"
  | "special_payout"
  | "dead_heat"
  | "source_defined"
  | "unknown";

// archive を v2 parser で再導出した 1 candidate（1 race × 1 bet_type）の要約。
export type ArchiveCandidate = {
  raceKey: string;
  betType: SettlementBetType;
  status: SettlementStatus;
  resultKind: ResultKind;
  payoutLineCount: number;
  refundLineCount: number;
  specialPayoutLineCount: number;
  payoutYenTotal: number;
};

// canonical DB 側 active candidate の要約（CLI が streaming で供給）。
export type CanonicalCandidate = {
  raceKey: string;
  betType: SettlementBetType;
  status: SettlementStatus;
  resultKind: ResultKind;
};

export type ReconcileClass =
  | "exact_match"
  | "status_mismatch"
  | "result_kind_mismatch"
  | "archive_only"
  | "canonical_only"
  | "ambiguous_canonical"
  | "parse_failure";

const BET_TYPE_SET: ReadonlySet<string> = new Set(BET_TYPES);

const VENUE_CODE_TO_NAME: ReadonlyMap<string, string> = new Map(
  Object.entries(VENUE_CODES).map(([name, code]) => [code, name]),
);

export function venueCodeFromKey(raceKey: string): string {
  const parts = raceKey.split(":");
  return parts.length >= 2 ? parts[1] : "unknown";
}

export function yearFromKey(raceKey: string): string {
  const date = raceKey.split(":")[0] ?? "";
  return /^\d{4}-/.test(date) ? date.slice(0, 4) : "unknown";
}

export function candidateKey(raceKey: string, betType: SettlementBetType): string {
  return `${raceKey}\u0000${betType}`;
}

// 券種別 payout/refund line から result_kind を導出する（v2 分類）。
function deriveResultKind(specialPayoutLines: number): ResultKind {
  return specialPayoutLines > 0 ? "special_payout" : "normal";
}

// ParsedResultDetail（v2）から canonical race identity 付き candidate を導出する。
// 未知 venue / 範囲外 raceNo は candidate を作らず除外（fail-closed）。
export function deriveArchiveCandidates(parsed: ParsedResultDetail): ArchiveCandidate[] {
  const raceKeyById = new Map<string, string>();
  for (const condition of parsed.conditions) {
    const code = VENUE_CODES[condition.venue];
    if (!code || condition.raceNo < 1 || condition.raceNo > 12) continue;
    raceKeyById.set(condition.raceId, `${condition.date}:${code}:R${condition.raceNo}`);
  }

  const grouped = new Map<string, { raceKey: string; betType: SettlementBetType; lines: typeof parsed.payouts }>();
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

  const out: ArchiveCandidate[] = [];
  for (const { raceKey, betType, lines } of grouped.values()) {
    const bucket = classifyRaceLines(betType, lines);
    const status = resolveStatus(bucket);
    if (!status) continue;
    const specialPayoutLineCount = bucket.payouts.filter((line) => line.lineKind === "special_payout").length;
    out.push({
      raceKey,
      betType,
      status,
      resultKind: deriveResultKind(specialPayoutLineCount),
      payoutLineCount: bucket.payouts.length,
      refundLineCount: bucket.refunds.length,
      specialPayoutLineCount,
      payoutYenTotal: bucket.payouts.reduce((sum, line) => sum + (line.payoutYen ?? 0), 0),
    });
  }
  out.sort((left, right) =>
    left.raceKey.localeCompare(right.raceKey) || left.betType.localeCompare(right.betType));
  return out;
}

// archive 側と canonical 側 1 candidate を突合して class を返す。
// canonical が同一 key に複数 active を持つ場合は呼び出し側で ambiguous_canonical を使う。
export function classifyPair(
  archive: ArchiveCandidate | null,
  canonical: CanonicalCandidate | null,
): Exclude<ReconcileClass, "ambiguous_canonical" | "parse_failure"> {
  if (archive && !canonical) return "archive_only";
  if (!archive && canonical) return "canonical_only";
  if (!archive || !canonical) throw new Error("classifyPair requires at least one candidate");
  if (archive.status !== canonical.status) return "status_mismatch";
  if (archive.resultKind !== canonical.resultKind) return "result_kind_mismatch";
  return "exact_match";
}

// status_mismatch の方向を判定する（canonical=返還系 && archive=settled は偽返還）。
const REFUND_STATUSES: ReadonlySet<SettlementStatus> = new Set(["refunded", "partially_refunded"]);
export function isFalseRefundDirection(
  archive: ArchiveCandidate,
  canonical: CanonicalCandidate,
): boolean {
  return REFUND_STATUSES.has(canonical.status) && archive.status === "settled";
}

// ---- 決定的集計 ----
export type ReconcileTotals = Record<ReconcileClass, number> & {
  falseRefund: number;
  archiveCandidates: number;
  canonicalCandidates: number;
};

export function emptyTotals(): ReconcileTotals {
  return {
    exact_match: 0,
    status_mismatch: 0,
    result_kind_mismatch: 0,
    archive_only: 0,
    canonical_only: 0,
    ambiguous_canonical: 0,
    parse_failure: 0,
    falseRefund: 0,
    archiveCandidates: 0,
    canonicalCandidates: 0,
  };
}

export function venueNameFromCode(code: string): string {
  return VENUE_CODE_TO_NAME.get(code) ?? code;
}

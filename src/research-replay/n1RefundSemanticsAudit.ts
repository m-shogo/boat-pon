import type { BetType, ParsedResultDetail, RacePayout } from "../domain/officialResultDetailParser";
import { classifyRaceLines, resolveStatus } from "./n1Backfill";
import type { SettlementStatus } from "./settlement";

export type RefundSemanticsEventKind =
  | "special_payout_added"
  | "false_refund_reclassified"
  | "other_change";

export type RefundSemanticsDiffRow = {
  raceId: string;
  date: string;
  betType: BetType;
  eventKind: RefundSemanticsEventKind;
  legacyStatus: SettlementStatus | null;
  currentStatus: SettlementStatus | null;
  legacyLineCount: number;
  currentLineCount: number;
  currentSpecialPayoutLines: number;
};

export type RefundSemanticsComparison = {
  legacyCandidateCount: number;
  currentCandidateCount: number;
  legacyRefundCandidates: number;
  currentRefundCandidates: number;
  currentSpecialPayoutCandidates: number;
  unchangedCandidates: number;
  unchangedRefundCandidates: number;
  changedRows: RefundSemanticsDiffRow[];
};

type CandidateSnapshot = {
  raceId: string;
  date: string;
  betType: BetType;
  status: SettlementStatus | null;
  lineCount: number;
  specialPayoutLines: number;
};

const keyOf = (raceId: string, betType: BetType): string => `${raceId}\u0000${betType}`;

function candidateSnapshots(parsed: ParsedResultDetail): Map<string, CandidateSnapshot> {
  const grouped = new Map<string, RacePayout[]>();
  for (const line of parsed.payouts) {
    const key = keyOf(line.raceId, line.betType);
    const lines = grouped.get(key) ?? [];
    lines.push(line);
    grouped.set(key, lines);
  }

  const snapshots = new Map<string, CandidateSnapshot>();
  for (const [key, lines] of grouped) {
    const first = lines[0];
    const bucket = classifyRaceLines(first.betType, lines);
    snapshots.set(key, {
      raceId: first.raceId,
      date: first.date,
      betType: first.betType,
      status: resolveStatus(bucket),
      lineCount: lines.length,
      specialPayoutLines: bucket.payouts.filter((line) => line.lineKind === "special_payout").length,
    });
  }
  return snapshots;
}

const isRefundStatus = (status: SettlementStatus | null): boolean =>
  status === "refunded" || status === "partially_refunded";

export function compareRefundSemantics(
  legacy: ParsedResultDetail,
  current: ParsedResultDetail,
): RefundSemanticsComparison {
  const legacyByKey = candidateSnapshots(legacy);
  const currentByKey = candidateSnapshots(current);
  const keys = [...new Set([...legacyByKey.keys(), ...currentByKey.keys()])].sort();

  const changedRows: RefundSemanticsDiffRow[] = [];
  let unchangedCandidates = 0;
  let unchangedRefundCandidates = 0;

  for (const key of keys) {
    const before = legacyByKey.get(key);
    const after = currentByKey.get(key);
    const legacyStatus = before?.status ?? null;
    const currentStatus = after?.status ?? null;
    const unchanged = legacyStatus === currentStatus
      && before?.lineCount === after?.lineCount
      && before?.specialPayoutLines === after?.specialPayoutLines;

    if (unchanged) {
      unchangedCandidates += 1;
      if (isRefundStatus(currentStatus)) unchangedRefundCandidates += 1;
      continue;
    }

    const eventKind: RefundSemanticsEventKind =
      !before && currentStatus === "settled" && (after?.specialPayoutLines ?? 0) > 0
        ? "special_payout_added"
        : legacyStatus === "refunded" && currentStatus === "settled"
          ? "false_refund_reclassified"
          : "other_change";

    const source = after ?? before;
    if (!source) continue;
    changedRows.push({
      raceId: source.raceId,
      date: source.date,
      betType: source.betType,
      eventKind,
      legacyStatus,
      currentStatus,
      legacyLineCount: before?.lineCount ?? 0,
      currentLineCount: after?.lineCount ?? 0,
      currentSpecialPayoutLines: after?.specialPayoutLines ?? 0,
    });
  }

  const values = (map: Map<string, CandidateSnapshot>): CandidateSnapshot[] => [...map.values()];
  const legacyValues = values(legacyByKey);
  const currentValues = values(currentByKey);
  return {
    legacyCandidateCount: legacyValues.length,
    currentCandidateCount: currentValues.length,
    legacyRefundCandidates: legacyValues.filter((item) => isRefundStatus(item.status)).length,
    currentRefundCandidates: currentValues.filter((item) => isRefundStatus(item.status)).length,
    currentSpecialPayoutCandidates: currentValues.filter((item) => item.specialPayoutLines > 0).length,
    unchangedCandidates,
    unchangedRefundCandidates,
    changedRows,
  };
}

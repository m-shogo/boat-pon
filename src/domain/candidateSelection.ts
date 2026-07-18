import type { BetCandidate } from "./types";

/**
 * 研究用: 全120通りから各レースのモデル最上位1件を再現可能に選ぶ。
 * productionへの接続はせず、live変更承認前の比較検証だけに使う。
 */
export function selectTopModelCandidatePerRace(candidates: BetCandidate[]): BetCandidate[] {
  const selected = new Map<string, BetCandidate>();
  const order: string[] = [];

  for (const candidate of candidates) {
    const existing = selected.get(candidate.raceId);
    if (!existing) {
      selected.set(candidate.raceId, candidate);
      order.push(candidate.raceId);
      continue;
    }
    if (compareCandidatePriority(candidate, existing) < 0) {
      selected.set(candidate.raceId, candidate);
    }
  }

  return order.map((raceId) => selected.get(raceId)!);
}

function compareCandidatePriority(a: BetCandidate, b: BetCandidate): number {
  const scoreDiff = finiteScore(b.modelSelectionScore) - finiteScore(a.modelSelectionScore);
  if (scoreDiff !== 0) return scoreDiff;
  const rateDiff = finiteScore(b.estimatedHitRate) - finiteScore(a.estimatedHitRate);
  if (rateDiff !== 0) return rateDiff;
  return a.selection.join("-").localeCompare(b.selection.join("-"));
}

function finiteScore(value: number | null | undefined): number {
  return value != null && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

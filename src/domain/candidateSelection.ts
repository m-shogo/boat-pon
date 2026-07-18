import type { BetCandidate, Decision } from "./types";

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

/**
 * 研究用: 判定済み候補から各レース1件を選ぶ。
 * BUY > WATCH > SKIP、同じstatusならEV、モデルスコアの順。
 * historical latest oddsを使う場合は締切前再現ではないためproduction接続禁止。
 */
export function selectBestPaperDecisionPerRace(
  rows: Array<{ candidate: BetCandidate; decision: Decision }>,
): Array<{ candidate: BetCandidate; decision: Decision }> {
  const selected = new Map<string, { candidate: BetCandidate; decision: Decision }>();
  const order: string[] = [];
  for (const row of rows) {
    const existing = selected.get(row.candidate.raceId);
    if (!existing) {
      selected.set(row.candidate.raceId, row);
      order.push(row.candidate.raceId);
      continue;
    }
    if (comparePaperDecision(row, existing) < 0) selected.set(row.candidate.raceId, row);
  }
  return order.map((raceId) => selected.get(raceId)!);
}

function comparePaperDecision(
  a: { candidate: BetCandidate; decision: Decision },
  b: { candidate: BetCandidate; decision: Decision },
) {
  const statusRank = { BUY: 0, WATCH: 1, SKIP: 2 } as const;
  const statusDiff = statusRank[a.decision.status] - statusRank[b.decision.status];
  if (statusDiff !== 0) return statusDiff;
  const evDiff = finiteScore(b.decision.ev) - finiteScore(a.decision.ev);
  if (evDiff !== 0) return evDiff;
  return compareCandidatePriority(a.candidate, b.candidate);
}

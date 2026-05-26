import type { DecisionHistoryRow } from "./backtest";
import type { BetCandidate, BudgetRule, Decision } from "./types";

export type DecisionChecklistItem = {
  label: string;
  ok: boolean;
  value: string;
};

export type DecisionExplanation = {
  headline: string;
  detail: string;
  tone: "buy" | "watch" | "skip";
  checklist: DecisionChecklistItem[];
};

export type SkipReasonSummary = {
  reason: string;
  count: number;
  share: number;
};

export function explainDecision(
  candidate: BetCandidate,
  decision: Decision,
  rule: BudgetRule,
): DecisionExplanation {
  const evText = decision.ev == null ? "未取得" : decision.ev.toFixed(2);
  const oddsText = candidate.currentOdds == null ? "未取得" : candidate.currentOdds.toFixed(1) + "倍";
  const hitRateText = hitRateSummary(candidate);
  const requiredText = decision.requiredOdds === Number.POSITIVE_INFINITY
    ? "算出不可"
    : decision.requiredOdds.toFixed(1) + "倍";

  if (decision.status === "BUY") {
    return {
      headline: "条件はそろっています。ただし購入前に公式で最終確認してください。",
      detail: `現在オッズ ${oddsText} が必要オッズ ${requiredText} を上回り、EVは ${evText} です。${hitRateText} 推奨は1点${decision.recommendedAmount}円までです。`,
      tone: "buy",
      checklist: buildChecklist(candidate, decision, rule),
    };
  }

  if (decision.status === "WATCH") {
    return {
      headline: "惜しい候補ですが、BUY基準には届いていません。",
      detail: `EVは ${evText}。${hitRateText} 記録だけ残し、通知と購入判断は見送ります。`,
      tone: "watch",
      checklist: buildChecklist(candidate, decision, rule),
    };
  }

  return {
    headline: primarySkipMessage(candidate, decision, rule),
    detail: `必要オッズは ${requiredText}、現在オッズは ${oddsText}、EVは ${evText} です。${hitRateText} 見送りを成功として記録します。`,
    tone: "skip",
    checklist: buildChecklist(candidate, decision, rule),
  };
}

export function summarizeSkipReasons(
  rows: DecisionHistoryRow[],
  rule: Pick<BudgetRule, "minSampleSize" | "targetEv">,
): SkipReasonSummary[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.decision !== "SKIP") continue;
    for (const reason of inferHistorySkipReasons(row, rule)) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count, share: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function buildChecklist(candidate: BetCandidate, decision: Decision, rule: BudgetRule): DecisionChecklistItem[] {
  const items: DecisionChecklistItem[] = [
    {
      label: "EV",
      ok: decision.ev != null && decision.ev >= rule.targetEv,
      value: decision.ev == null ? "未取得" : decision.ev.toFixed(2) + " / 目標" + rule.targetEv.toFixed(2),
    },
    {
      label: "サンプル",
      ok: candidate.sampleSize >= rule.minSampleSize,
      value: candidate.sampleSize.toLocaleString() + " / " + rule.minSampleSize.toLocaleString(),
    },
    {
      label: "オッズ",
      ok: candidate.currentOdds != null && candidate.currentOdds >= decision.requiredOdds,
      value: candidate.currentOdds == null ? "未取得" : candidate.currentOdds.toFixed(1) + "倍",
    },
    {
      label: "保守化",
      ok: true,
      value: conservativeDiscountText(candidate),
    },
    {
      label: "リスク",
      ok: !candidate.hasRiskFlag,
      value: candidate.hasRiskFlag ? "要確認" : "通常",
    },
    {
      label: "推奨額",
      ok: decision.recommendedAmount <= rule.maxStakePerRaceYen,
      value: decision.recommendedAmount.toLocaleString() + "円 / 上限" + rule.maxStakePerRaceYen.toLocaleString() + "円",
    },
  ];
  return items;
}

function hitRateSummary(candidate: BetCandidate): string {
  const raw = candidate.rawEstimatedHitRate;
  const conservative = candidate.conservativeHitRate ?? candidate.estimatedHitRate;
  if (raw == null || raw <= 0) {
    return `判定的中率は${(candidate.estimatedHitRate * 100).toFixed(1)}%です。`;
  }
  return `推定的中率は保守化前${(raw * 100).toFixed(1)}%、判定用${(conservative * 100).toFixed(1)}%です。`;
}

function conservativeDiscountText(candidate: BetCandidate): string {
  const raw = candidate.rawEstimatedHitRate;
  const conservative = candidate.conservativeHitRate ?? candidate.estimatedHitRate;
  if (raw == null || raw <= 0) return "対象外";
  const discount = Math.max(0, 1 - conservative / raw);
  return `${(raw * 100).toFixed(1)}% → ${(conservative * 100).toFixed(1)}% (${(discount * 100).toFixed(0)}%減)`;
}

function primarySkipMessage(candidate: BetCandidate, decision: Decision, rule: BudgetRule): string {
  if (candidate.sampleSize < rule.minSampleSize) return "サンプル不足なので見送ります。";
  if (candidate.currentOdds == null) return "オッズ未取得なので手動確認待ちです。";
  if (decision.ev != null && decision.ev < 1.05) return "EVが低いため見送りです。";
  if (decision.reasons.length > 0) return decision.reasons[0];
  return "BUY条件に届かないため見送りです。";
}

function inferHistorySkipReasons(
  row: DecisionHistoryRow,
  rule: Pick<BudgetRule, "minSampleSize" | "targetEv">,
): string[] {
  const reasons: string[] = [];
  if (row.sampleSize < rule.minSampleSize) reasons.push("サンプル不足");
  if (row.currentOdds == null) reasons.push("オッズ未取得");
  if (row.returned) reasons.push("返還あり");
  if (row.ev != null && row.ev < 1.05) reasons.push("EV不足");
  if (row.ev != null && row.ev >= 1.05 && row.ev < rule.targetEv) reasons.push("目標EV未満");
  if (reasons.length === 0) reasons.push("安全条件未達");
  return reasons;
}

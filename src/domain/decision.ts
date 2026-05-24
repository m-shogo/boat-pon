import type { BetCandidate, BudgetRule, Decision, OddsCalibrationFactor } from "./types";

export const DEFAULT_RULE: BudgetRule = {
  dailyBudgetYen: 1000,
  stakePerBetYen: 100,
  maxStakePerRaceYen: 100,
  maxBuyCountPerDay: 5,
  minSampleSize: 600,
  minMinutesBeforeClose: 5,
  targetEv: 1.25,
};

const WATCH_ONLY_ODDS_THRESHOLD = 100;
export const V3_EMPIRICAL_ODDS_CALIBRATION: OddsCalibrationFactor[] = [
  { maxRequiredOdds: 30, factor: 1 },
  { maxRequiredOdds: 50, factor: 0.55 },
  { maxRequiredOdds: Number.MAX_SAFE_INTEGER, factor: 0.45 },
];

export function requiredOdds(targetEv: number, estimatedHitRate: number): number {
  if (estimatedHitRate <= 0) return Number.POSITIVE_INFINITY;
  return targetEv / estimatedHitRate;
}

export function expectedValue(estimatedHitRate: number, odds: number | null): number | null {
  if (odds == null) return null;
  return estimatedHitRate * odds;
}

export function blendedHitRate(estimatedHitRate: number, currentOdds: number | null, marketBlendWeight: number): number {
  if (currentOdds == null || marketBlendWeight <= 0) return estimatedHitRate;
  // kyotei payout rate is ~75%
  const marketImplied = (1 / currentOdds) * 0.75;
  return (1 - marketBlendWeight) * estimatedHitRate + marketBlendWeight * marketImplied;
}

export function calibratedHitRate(estimatedHitRate: number, targetEv: number, rule: BudgetRule, currentOdds: number | null = null): number {
  if (rule.calibrationMode !== "v3-empirical") return estimatedHitRate;
  const req = requiredOdds(targetEv, estimatedHitRate);
  const basisValue = rule.calibrationBasis === "currentOdds" && currentOdds != null ? currentOdds : req;
  const factor = calibrationFactorForRequiredOdds(basisValue, rule.oddsCalibrationFactors ?? V3_EMPIRICAL_ODDS_CALIBRATION);
  return estimatedHitRate * factor;
}

export function calibrationFactorForRequiredOdds(requiredOddsValue: number, factors: OddsCalibrationFactor[]): number {
  const validFactors = factors
    .filter((row) => Number.isFinite(row.maxRequiredOdds) && Number.isFinite(row.factor) && row.maxRequiredOdds > 0 && row.factor > 0)
    .sort((a, b) => a.maxRequiredOdds - b.maxRequiredOdds);
  if (validFactors.length === 0) return 1;
  return validFactors.find((row) => requiredOddsValue < row.maxRequiredOdds)?.factor ?? validFactors.at(-1)!.factor;
}

export function minutesUntil(closeAt: string, now = new Date()): number {
  const [hour, minute] = closeAt.split(":").map(Number);
  const close = new Date(now);
  close.setHours(hour, minute, 0, 0);
  if (close.getTime() < now.getTime()) {
    close.setDate(close.getDate() + 1);
  }
  return (close.getTime() - now.getTime()) / 60000;
}

export function judgeCandidate(
  candidate: BetCandidate,
  rule: BudgetRule = DEFAULT_RULE,
  context: { buyCountToday?: number; reservedBudgetYen?: number; now?: Date } = {},
): Decision {
  const reasons: string[] = [];
  const blendWeight = rule.marketBlendWeight ?? 0;
  const calibrated = calibratedHitRate(candidate.estimatedHitRate, rule.targetEv, rule, candidate.currentOdds);
  const effectiveHitRate = blendedHitRate(calibrated, candidate.currentOdds, blendWeight);
  const req = requiredOdds(rule.targetEv, effectiveHitRate);
  const ev = expectedValue(effectiveHitRate, candidate.currentOdds);
  const buyCountToday = context.buyCountToday ?? 0;
  const reservedBudgetYen = context.reservedBudgetYen ?? 0;
  const minutes = minutesUntil(candidate.closeAt, context.now);

  if (candidate.sampleSize < rule.minSampleSize) reasons.push("サンプル不足");
  if (candidate.currentOdds == null) reasons.push("オッズ未取得");
  if (candidate.currentOdds != null && candidate.currentOdds >= WATCH_ONLY_ODDS_THRESHOLD) {
    reasons.push("100倍超オッズは検証保留");
  }
  if (rule.maxOdds != null && candidate.currentOdds != null && candidate.currentOdds > rule.maxOdds) {
    reasons.push(`オッズ上限超過(${rule.maxOdds}倍)`);
  }
  if (rule.maxOddsRatio != null && candidate.currentOdds != null && req < Infinity && candidate.currentOdds > req * rule.maxOddsRatio) {
    reasons.push(`市場オッズがモデル要求の${rule.maxOddsRatio}倍超`);
  }
  if (rule.minOddsRatio != null && candidate.currentOdds != null && req < Infinity && candidate.currentOdds < req * rule.minOddsRatio) {
    reasons.push(`市場オッズがモデル要求の${rule.minOddsRatio}倍未満`);
  }
  if (minutes < rule.minMinutesBeforeClose) reasons.push("締切が近すぎる");
  if (candidate.notified) reasons.push("同一レース通知済み");
  if (candidate.hasRiskFlag) reasons.push("欠場/返還など要確認");
  if (candidate.environmentRiskLevel === "high") reasons.push("荒天/安定板など環境リスク高");
  if (buyCountToday >= rule.maxBuyCountPerDay) reasons.push("1日最大BUY数に到達");
  if (reservedBudgetYen + rule.stakePerBetYen > rule.dailyBudgetYen) reasons.push("1日予算上限");

  const allowedStake = Math.min(rule.stakePerBetYen, rule.maxStakePerRaceYen);

  if (ev != null && ev >= rule.targetEv && reasons.length === 0) {
    return {
      status: "BUY",
      requiredOdds: req,
      ev,
      recommendedAmount: allowedStake,
      reasons: ["EV条件を満たす"],
    };
  }

  if (ev != null && ev >= 1.05 && (ev < rule.targetEv || reasons.includes("100倍超オッズは検証保留"))) {
    return {
      status: "WATCH",
      requiredOdds: req,
      ev,
      recommendedAmount: 0,
      reasons: reasons.length ? reasons : ["EVがBUY基準未満"],
    };
  }

  return {
    status: "SKIP",
    requiredOdds: req,
    ev,
    recommendedAmount: 0,
    reasons: reasons.length ? reasons : ["EVが低い"],
  };
}

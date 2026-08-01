// N2 training dataset contract（設計＋enforcement、model trainingは行わない）。
// N1 canonical active settlement を label source とし、eligibility / target / PIT を fail-closed で判定する。
// 純関数のみ。DB/production/model へは接続しない。
import type { SettlementStatus, ResolutionStatus } from "./settlement";

export const N2_DATASET_CONTRACT_VERSION = "n2-dataset-contract-v1";
export const N2_TARGET_CONTRACT_VERSION = "n2-target-contract-v2";
export const N2_FEATURE_PIT_CONTRACT_VERSION = "n2-feature-pit-contract-v1";

// ===== eligibility（settlement state → dataset 採否） =====
export type EligibilityCode =
  | "eligible"
  | "excluded_unsettled"        // pending
  | "excluded_cancelled"        // cancelled
  | "excluded_no_sale"          // no_sale（当該券種発売なし）
  | "excluded_refunded"         // 全返還（hit/miss label 不成立）
  | "excluded_conflict"         // source_conflict（自動採用しない）
  | "excluded_unresolved"       // unresolved/quarantined
  | "excluded_source_duplicate" // canonical で無効化された重複 copy
  | "excluded_unknown";         // 未知 → fail closed

export type CandidateEligibilityInput = {
  settlementStatus: SettlementStatus;
  resolutionStatus: ResolutionStatus;
  isSourceDuplicate: boolean; // settlement_source_duplicate_resolutions_v2 に duplicate として存在するか
};

// fail-closed: 既知の eligible 条件以外はすべて除外し、理由コードを必ず付ける。
export function classifyEligibility(input: CandidateEligibilityInput): { eligible: boolean; reason: EligibilityCode } {
  if (input.isSourceDuplicate) return { eligible: false, reason: "excluded_source_duplicate" };
  // resolution が resolved 以外は採用しない（conflict/unresolved/quarantined を fail-closed）。
  if (input.resolutionStatus === "source_conflict") return { eligible: false, reason: "excluded_conflict" };
  if (input.resolutionStatus === "unresolved" || input.resolutionStatus === "quarantined") {
    return { eligible: false, reason: "excluded_unresolved" };
  }
  if (input.resolutionStatus !== "resolved") return { eligible: false, reason: "excluded_unknown" };
  switch (input.settlementStatus) {
    case "settled":
      return { eligible: true, reason: "eligible" };
    case "partially_refunded":
      // payout line が存在するため hit/miss label は成立する（refund は financial target 側で扱う）。
      return { eligible: true, reason: "eligible" };
    case "refunded":
      return { eligible: false, reason: "excluded_refunded" };
    case "cancelled":
      return { eligible: false, reason: "excluded_cancelled" };
    case "no_sale":
      return { eligible: false, reason: "excluded_no_sale" };
    case "pending":
      return { eligible: false, reason: "excluded_unsettled" };
    default:
      return { eligible: false, reason: "excluded_unknown" };
  }
}

// ===== target derivation（canonical active settlement → label） =====
export type BetSelectionLabelInput = {
  eligibility: { eligible: boolean; reason: EligibilityCode };
  betSelection: string;        // 評価対象の買い目 canonical（例 "1-2-3"）
  winningSelections: string[]; // 当該 candidate の payout line canonical 群（同着/複勝/wide で複数）
  payoutYenBySelection: Record<string, number>; // canonical → payout_yen（100円あたり）
  // 一部返還はcandidate全体を除外せず、返還対象selectionだけをlossから分離する。
  refundedSelections?: string[];
  refundYenBySelection?: Record<string, number | null>;
  // 特払いは的中selectionを持たない券種別financial outcome。通常hitへ推測変換しない。
  specialPayoutYenPer100?: number | null;
};

export type BetLabelOutcome = "hit" | "loss" | "refund" | "special_payout" | "void";

export type BetLabel = {
  eligible: boolean;
  reason: EligibilityCode;
  outcome: BetLabelOutcome;
  hit: 0 | 1 | null;           // refund/special_payout/void は null（classification loss にしない）
  payoutYenPer100: number | null; // financial target。refund/special_payoutは実額、voidはnull
};

// hit/miss は canonical active settlement の payout line からのみ導出。
// refund を loss、unresolved を loss として扱わない（fail-closed で null）。
export function deriveBetLabel(input: BetSelectionLabelInput): BetLabel {
  if (!input.eligibility.eligible) {
    return {
      eligible: false,
      reason: input.eligibility.reason,
      outcome: "void",
      hit: null,
      payoutYenPer100: null,
    };
  }
  if (input.refundedSelections?.includes(input.betSelection)) {
    return {
      eligible: true,
      reason: "eligible",
      outcome: "refund",
      hit: null,
      payoutYenPer100: input.refundYenBySelection?.[input.betSelection] ?? null,
    };
  }
  if (input.specialPayoutYenPer100 != null) {
    return {
      eligible: true,
      reason: "eligible",
      outcome: "special_payout",
      hit: null,
      payoutYenPer100: input.specialPayoutYenPer100,
    };
  }
  const hit = input.winningSelections.includes(input.betSelection) ? 1 : 0;
  const payout = hit ? (input.payoutYenBySelection[input.betSelection] ?? 0) : 0;
  return {
    eligible: true,
    reason: "eligible",
    outcome: hit ? "hit" : "loss",
    hit,
    payoutYenPer100: payout,
  };
}

// ===== feature PIT contract（available_at <= decision cutoff、fail-closed） =====
// programFeatureSafety.ts の live-only/historical-safe 分類を N2 の PIT 判定へ統合する。
export type FeaturePITClass = "historical_safe" | "live_only" | "odds_timed" | "unknown";

export type FeatureAvailability = {
  featureKey: string;
  pitClass: FeaturePITClass;
  availableAt: string | null; // ISO。null = 有効時点不明
};

export type PITMode = "historical" | "live";

export type FeaturePITResult = {
  featureKey: string;
  usable: boolean;
  reason:
    | "pit_safe"
    | "excluded_pit_after_cutoff"
    | "excluded_pit_unknown_availability"
    | "excluded_live_only_in_historical";
};

// decisionCutoff（通常 race lock time）以前に available だった feature のみ使用可。
// historical mode では live-only を常に除外。available_at 不明は fail-closed（除外）。
export function validateFeaturePIT(
  feature: FeatureAvailability,
  decisionCutoff: string,
  mode: PITMode,
): FeaturePITResult {
  if (mode === "historical" && feature.pitClass === "live_only") {
    return { featureKey: feature.featureKey, usable: false, reason: "excluded_live_only_in_historical" };
  }
  if (feature.pitClass === "unknown" || feature.availableAt === null) {
    return { featureKey: feature.featureKey, usable: false, reason: "excluded_pit_unknown_availability" };
  }
  const avail = Date.parse(feature.availableAt);
  const cutoff = Date.parse(decisionCutoff);
  if (!Number.isFinite(avail) || !Number.isFinite(cutoff)) {
    return { featureKey: feature.featureKey, usable: false, reason: "excluded_pit_unknown_availability" };
  }
  // 同一 millisecond は inclusive（available_at == cutoff は可）。
  if (avail > cutoff) {
    return { featureKey: feature.featureKey, usable: false, reason: "excluded_pit_after_cutoff" };
  }
  return { featureKey: feature.featureKey, usable: true, reason: "pit_safe" };
}

// ===== odds timing contract =====
export type OddsRole = "feature" | "evaluation" | "decision";
export type OddsKind = "live_checkpoint" | "closing" | "post_race_imputed" | "unknown";

// training-time feature に closing/post-race odds を入れない。closing は evaluation 専用。
export function validateOddsUsage(kind: OddsKind, role: OddsRole): { usable: boolean; reason: string } {
  if (role === "feature") {
    if (kind === "live_checkpoint") return { usable: true, reason: "live_checkpoint_before_cutoff_ok" };
    return { usable: false, reason: `feature role forbids ${kind} odds (leakage/imputation risk)` };
  }
  if (role === "evaluation") {
    if (kind === "closing") return { usable: true, reason: "closing_odds_for_price_evaluation_only" };
    if (kind === "live_checkpoint") return { usable: true, reason: "checkpoint_odds_ok_for_eval" };
    return { usable: false, reason: `evaluation forbids ${kind}` };
  }
  // decision: 意思決定時点で available だった odds のみ
  if (kind === "live_checkpoint") return { usable: true, reason: "available_at_decision" };
  return { usable: false, reason: `decision forbids ${kind}` };
}

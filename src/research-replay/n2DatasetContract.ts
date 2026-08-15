// N2 training dataset contract（設計＋enforcement、model trainingは行わない）。
// N1 canonical active settlement を label source とし、eligibility / target / PIT を fail-closed で判定する。
// 純関数のみ。DB/production/model へは接続しない。
import type { SettlementBetType, SettlementStatus, ResolutionStatus } from "./settlement";

export const N2_DATASET_CONTRACT_VERSION = "n2-dataset-contract-v1";
export const N2_TARGET_CONTRACT_VERSION = "n2-target-contract-v2";
export const N2_FEATURE_PIT_CONTRACT_VERSION = "n2-feature-pit-contract-v2";

// ===== eligibility（settlement state → dataset 採否） =====
export type EligibilityCode =
  | "eligible"
  | "excluded_unsettled"
  | "excluded_cancelled"
  | "excluded_no_sale"
  | "excluded_refunded"
  | "excluded_conflict"
  | "excluded_unresolved"
  | "excluded_source_duplicate"
  | "excluded_unknown";

export type CandidateEligibilityInput = {
  settlementStatus: SettlementStatus;
  resolutionStatus: ResolutionStatus;
  isSourceDuplicate: boolean;
};

export function classifyEligibility(input: CandidateEligibilityInput): { eligible: boolean; reason: EligibilityCode } {
  if (input.isSourceDuplicate) return { eligible: false, reason: "excluded_source_duplicate" };
  if (input.resolutionStatus === "source_conflict") return { eligible: false, reason: "excluded_conflict" };
  if (input.resolutionStatus === "unresolved" || input.resolutionStatus === "quarantined") {
    return { eligible: false, reason: "excluded_unresolved" };
  }
  if (input.resolutionStatus !== "resolved") return { eligible: false, reason: "excluded_unknown" };
  switch (input.settlementStatus) {
    case "settled":
    case "partially_refunded":
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
  betSelection: string;
  winningSelections: string[];
  payoutYenBySelection: Record<string, number>;
  refundedSelections?: string[];
  refundYenBySelection?: Record<string, number | null>;
  specialPayoutYenPer100?: number | null;
};

export type BetLabelOutcome = "hit" | "loss" | "refund" | "special_payout" | "void";

export type BetLabel = {
  eligible: boolean;
  reason: EligibilityCode;
  outcome: BetLabelOutcome;
  hit: 0 | 1 | null;
  payoutYenPer100: number | null;
};

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

// ===== full selection space（race × bet_type × bet_selection） =====
export const N2_SELECTION_COUNT_BY_BET_TYPE: Readonly<Record<SettlementBetType, number>> = {
  win: 6,
  place: 6,
  exacta: 30,
  quinella: 15,
  trifecta: 120,
  trio: 20,
  wide: 15,
};

const N2_SELECTION_ARITY: Readonly<Record<SettlementBetType, 1 | 2 | 3>> = {
  win: 1,
  place: 1,
  exacta: 2,
  quinella: 2,
  trifecta: 3,
  trio: 3,
  wide: 2,
};

const N2_UNORDERED_BET_TYPES = new Set<SettlementBetType>(["quinella", "wide", "trio"]);

export function enumerateBetSelections(betType: SettlementBetType): string[] {
  const arity = N2_SELECTION_ARITY[betType];
  const unordered = N2_UNORDERED_BET_TYPES.has(betType);
  const selections: string[] = [];

  const visit = (prefix: number[]): void => {
    if (prefix.length === arity) {
      selections.push(prefix.join("-"));
      return;
    }
    const minimum = unordered && prefix.length > 0 ? prefix[prefix.length - 1] + 1 : 1;
    for (let boat = minimum; boat <= 6; boat += 1) {
      if (prefix.includes(boat)) continue;
      visit([...prefix, boat]);
    }
  };

  visit([]);
  const expected = N2_SELECTION_COUNT_BY_BET_TYPE[betType];
  if (selections.length !== expected || new Set(selections).size !== expected) {
    throw new Error(`N2_SELECTION_SPACE_INVARIANT:${betType}:${selections.length}/${expected}`);
  }
  return selections;
}

export type SelectionLevelLabelInput = Omit<BetSelectionLabelInput, "betSelection"> & {
  betType: SettlementBetType;
};

export type SelectionLevelLabel = BetLabel & {
  betType: SettlementBetType;
  betSelection: string;
};

export function deriveSelectionLevelLabels(input: SelectionLevelLabelInput): SelectionLevelLabel[] {
  return enumerateBetSelections(input.betType).map((betSelection) => ({
    betType: input.betType,
    betSelection,
    ...deriveBetLabel({ ...input, betSelection }),
  }));
}

function hasValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function isExplicitTimestamp(value: string | null): value is string {
  if (value === null || !hasValidCalendarDate(value)) return false;
  const clock = /T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?/.exec(value);
  if (clock === null) return false;
  if (Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3]) > 59) return false;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return false;
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(value);
  if (offset !== null && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

// ===== feature PIT contract（available_at <= decision cutoff、fail-closed） =====
export type FeaturePITClass = "historical_safe" | "live_only" | "odds_timed" | "unknown";

export type FeatureAvailability = {
  featureKey: string;
  pitClass: FeaturePITClass;
  availableAt: string | null;
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

export function validateFeaturePIT(
  feature: FeatureAvailability,
  decisionCutoff: string,
  mode: PITMode,
): FeaturePITResult {
  if (mode === "historical" && feature.pitClass === "live_only") {
    return { featureKey: feature.featureKey, usable: false, reason: "excluded_live_only_in_historical" };
  }
  if (feature.pitClass === "unknown" || !isExplicitTimestamp(feature.availableAt) || !isExplicitTimestamp(decisionCutoff)) {
    return { featureKey: feature.featureKey, usable: false, reason: "excluded_pit_unknown_availability" };
  }
  const avail = Date.parse(feature.availableAt);
  const cutoff = Date.parse(decisionCutoff);
  if (avail > cutoff) {
    return { featureKey: feature.featureKey, usable: false, reason: "excluded_pit_after_cutoff" };
  }
  return { featureKey: feature.featureKey, usable: true, reason: "pit_safe" };
}

// ===== odds timing contract =====
export type OddsRole = "feature" | "evaluation" | "decision";
export type OddsKind = "live_checkpoint" | "closing" | "post_race_imputed" | "unknown";

export type OddsUsageInput = {
  kind: OddsKind;
  role: OddsRole;
  capturedAt: string | null;
  availableAt: string | null;
  decisionCutoff: string | null;
};

export type OddsUsageReason =
  | "odds_safe"
  | "closing_odds_for_price_evaluation_only"
  | "excluded_odds_kind_for_role"
  | "excluded_odds_unknown_timestamp"
  | "excluded_odds_available_after_capture"
  | "excluded_odds_capture_after_cutoff"
  | "excluded_odds_available_after_cutoff";

export type OddsUsageResult = { usable: boolean; reason: OddsUsageReason };

export function validateOddsUsage(input: OddsUsageInput): OddsUsageResult {
  const kindAllowed = input.kind === "live_checkpoint"
    || (input.role === "evaluation" && input.kind === "closing");
  if (!kindAllowed) return { usable: false, reason: "excluded_odds_kind_for_role" };

  if (!isExplicitTimestamp(input.capturedAt) || !isExplicitTimestamp(input.availableAt)) {
    return { usable: false, reason: "excluded_odds_unknown_timestamp" };
  }
  const captured = Date.parse(input.capturedAt);
  const available = Date.parse(input.availableAt);
  if (input.kind === "live_checkpoint") {
    if (!isExplicitTimestamp(input.decisionCutoff)) {
      return { usable: false, reason: "excluded_odds_unknown_timestamp" };
    }
    const cutoff = Date.parse(input.decisionCutoff);
    if (captured > cutoff) {
      return { usable: false, reason: "excluded_odds_capture_after_cutoff" };
    }
    if (available > cutoff) {
      return { usable: false, reason: "excluded_odds_available_after_cutoff" };
    }
  }
  if (available > captured) {
    return { usable: false, reason: "excluded_odds_available_after_capture" };
  }

  return input.kind === "closing"
    ? { usable: true, reason: "closing_odds_for_price_evaluation_only" }
    : { usable: true, reason: "odds_safe" };
}

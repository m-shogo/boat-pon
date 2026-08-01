import { createHash } from "node:crypto";
import {
  classifyEligibility,
  deriveSelectionLevelLabels,
  enumerateBetSelections,
  type BetLabelOutcome,
  type EligibilityCode,
  type SelectionLevelLabel,
} from "./n2DatasetContract";
import type {
  ResolutionStatus,
  SettlementBetType,
  SettlementStatus,
} from "./settlement";

export type N2PayoutLineInput = {
  selection: string | null;
  payoutYen: number;
  lineKind: "payout" | "special_payout";
};

export type N2RefundLineInput = {
  selection: string | null;
  scope: "selection" | "bet_type" | "race";
  refundYenPer100: number | null;
};

export type N2SelectionProfileCandidate = {
  candidateId: string;
  canonicalRaceKey: string;
  betType: SettlementBetType;
  settlementStatus: SettlementStatus;
  resolutionStatus: ResolutionStatus;
  isSourceDuplicate: boolean;
  payouts: N2PayoutLineInput[];
  refunds: N2RefundLineInput[];
};

type OutcomeCounts = Record<BetLabelOutcome, number>;

export type N2PayoutDistribution = {
  count: number;
  min: number | null;
  p50: number | null;
  p90: number | null;
  p99: number | null;
  max: number | null;
  mean: number | null;
};

export type N2BetTypeSelectionProfile = {
  candidates: number;
  eligibleCandidates: number;
  selections: number;
  outcomes: OutcomeCounts;
  classificationRows: number;
  hits: number;
  hitRate: number | null;
  positivePayoutYenPer100: N2PayoutDistribution;
};

export type N2SelectionProfile = {
  candidateCount: number;
  eligibleCandidateCount: number;
  selectionCount: number;
  eligibilityByReason: Record<EligibilityCode, number>;
  outcomes: OutcomeCounts;
  byBetType: Record<SettlementBetType, N2BetTypeSelectionProfile>;
  labelDigest: string;
};

const BET_TYPES: SettlementBetType[] = [
  "win", "place", "exacta", "quinella", "trifecta", "trio", "wide",
];

const emptyOutcomes = (): OutcomeCounts => ({
  hit: 0,
  loss: 0,
  refund: 0,
  special_payout: 0,
  void: 0,
});

type MutableBetProfile = Omit<N2BetTypeSelectionProfile, "positivePayoutYenPer100"> & {
  positivePayouts: number[];
};

function uniqueAmount(values: Array<number | null>, errorCode: string): number | null | undefined {
  if (values.length === 0) return undefined;
  const unique = [...new Set(values.map((value) => value == null ? "null" : String(value)))];
  if (unique.length !== 1) throw new Error(errorCode);
  return values[0];
}

function candidateLabels(candidate: N2SelectionProfileCandidate): {
  eligibilityReason: EligibilityCode;
  eligible: boolean;
  labels: SelectionLevelLabel[];
} {
  const eligibility = classifyEligibility({
    settlementStatus: candidate.settlementStatus,
    resolutionStatus: candidate.resolutionStatus,
    isSourceDuplicate: candidate.isSourceDuplicate,
  });

  const payoutYenBySelection: Record<string, number> = {};
  const winningSelections: string[] = [];
  for (const line of candidate.payouts.filter((item) => item.lineKind === "payout")) {
    if (line.selection === null) throw new Error("N2_PAYOUT_SELECTION_MISSING");
    const prior = payoutYenBySelection[line.selection];
    if (prior !== undefined && prior !== line.payoutYen) {
      throw new Error(`N2_CONFLICTING_PAYOUT:${candidate.candidateId}:${line.selection}`);
    }
    if (prior === undefined) winningSelections.push(line.selection);
    payoutYenBySelection[line.selection] = line.payoutYen;
  }

  const specialPayoutYenPer100 = uniqueAmount(
    candidate.payouts.filter((item) => item.lineKind === "special_payout").map((item) => item.payoutYen),
    `N2_CONFLICTING_SPECIAL_PAYOUT:${candidate.candidateId}`,
  );

  const allSelections = enumerateBetSelections(candidate.betType);
  const refundAll = candidate.refunds.some((line) => line.scope === "bet_type" || line.scope === "race");
  const refundedSelections = refundAll
    ? allSelections
    : candidate.refunds.filter((line) => line.scope === "selection").map((line) => {
      if (line.selection === null) throw new Error("N2_REFUND_SELECTION_MISSING");
      return line.selection;
    });
  const refundYenBySelection: Record<string, number | null> = {};
  for (const selection of refundedSelections) {
    const relevant = candidate.refunds.filter((line) =>
      line.scope === "bet_type" || line.scope === "race" || line.selection === selection);
    const amount = uniqueAmount(
      relevant.map((line) => line.refundYenPer100),
      `N2_CONFLICTING_REFUND:${candidate.candidateId}:${selection}`,
    );
    refundYenBySelection[selection] = amount ?? null;
  }

  return {
    eligible: eligibility.eligible,
    eligibilityReason: eligibility.reason,
    labels: deriveSelectionLevelLabels({
      betType: candidate.betType,
      eligibility,
      winningSelections,
      payoutYenBySelection,
      refundedSelections,
      refundYenBySelection,
      specialPayoutYenPer100: specialPayoutYenPer100 ?? null,
    }),
  };
}

const quantile = (sorted: number[], q: number): number | null => {
  if (sorted.length === 0) return null;
  return sorted[Math.ceil(q * sorted.length) - 1];
};

function payoutDistribution(values: number[]): N2PayoutDistribution {
  if (values.length === 0) {
    return { count: 0, min: null, p50: null, p90: null, p99: null, max: null, mean: null };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1],
    mean: +(sum / sorted.length).toFixed(4),
  };
}

export function buildN2SelectionProfile(
  candidates: N2SelectionProfileCandidate[],
): N2SelectionProfile {
  const ordered = [...candidates].sort((left, right) =>
    left.canonicalRaceKey.localeCompare(right.canonicalRaceKey)
    || left.betType.localeCompare(right.betType)
    || left.candidateId.localeCompare(right.candidateId));

  const digest = createHash("sha256");
  const outcomes = emptyOutcomes();
  const eligibilityByReason = {} as Record<EligibilityCode, number>;
  const byBetMutable = Object.fromEntries(BET_TYPES.map((betType) => [betType, {
    candidates: 0,
    eligibleCandidates: 0,
    selections: 0,
    outcomes: emptyOutcomes(),
    classificationRows: 0,
    hits: 0,
    hitRate: null,
    positivePayouts: [],
  }])) as Record<SettlementBetType, MutableBetProfile>;

  let eligibleCandidateCount = 0;
  let selectionCount = 0;
  for (const candidate of ordered) {
    const result = candidateLabels(candidate);
    eligibilityByReason[result.eligibilityReason] =
      (eligibilityByReason[result.eligibilityReason] ?? 0) + 1;
    if (result.eligible) eligibleCandidateCount += 1;

    const bet = byBetMutable[candidate.betType];
    bet.candidates += 1;
    if (result.eligible) bet.eligibleCandidates += 1;
    for (const label of result.labels) {
      outcomes[label.outcome] += 1;
      bet.outcomes[label.outcome] += 1;
      bet.selections += 1;
      selectionCount += 1;
      if (label.hit !== null) {
        bet.classificationRows += 1;
        if (label.hit === 1) bet.hits += 1;
      }
      if (label.payoutYenPer100 !== null && label.payoutYenPer100 > 0) {
        bet.positivePayouts.push(label.payoutYenPer100);
      }
      digest.update([
        candidate.candidateId,
        candidate.canonicalRaceKey,
        candidate.betType,
        label.betSelection,
        label.outcome,
        label.hit == null ? "null" : String(label.hit),
        label.payoutYenPer100 == null ? "null" : String(label.payoutYenPer100),
      ].join("|"));
      digest.update("\n");
    }
  }

  const byBetType = Object.fromEntries(BET_TYPES.map((betType) => {
    const item = byBetMutable[betType];
    return [betType, {
      candidates: item.candidates,
      eligibleCandidates: item.eligibleCandidates,
      selections: item.selections,
      outcomes: item.outcomes,
      classificationRows: item.classificationRows,
      hits: item.hits,
      hitRate: item.classificationRows === 0 ? null : +(item.hits / item.classificationRows).toFixed(8),
      positivePayoutYenPer100: payoutDistribution(item.positivePayouts),
    }];
  })) as Record<SettlementBetType, N2BetTypeSelectionProfile>;

  return {
    candidateCount: ordered.length,
    eligibleCandidateCount,
    selectionCount,
    eligibilityByReason,
    outcomes,
    byBetType,
    labelDigest: digest.digest("hex"),
  };
}

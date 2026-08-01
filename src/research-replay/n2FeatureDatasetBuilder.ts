// N2 selection-level feature dataset builder scaffold（純関数・read-only）。
// DB access/model training/persistent dataset writeは行わず、label/PIT/provenance契約を一か所で強制する。
import {
  deriveSelectionLevelLabels,
  validateFeaturePIT,
  validateOddsUsage,
  type EligibilityCode,
  type FeaturePITClass,
  type OddsKind,
  type PITMode,
  type SelectionLevelLabel,
} from "./n2DatasetContract";
import type { SettlementBetType } from "./settlement";
import { HISTORICAL_SAFE_FEATURE_KEYS, LIVE_ONLY_FEATURE_KEYS } from "../domain/programFeatureSafety";

export const N2_FEATURE_DATASET_BUILDER_VERSION = "n2-feature-dataset-builder-v1";

export type N2FeatureValue = string | number | boolean | null;

export type N2FeatureObservation = {
  featureKey: string;
  value: N2FeatureValue;
  pitClass: FeaturePITClass;
  availableAt: string | null;
  observationId: string;
  rawDocumentId: string;
};

export type N2OddsObservation = {
  betSelection: string;
  odds: number;
  kind: OddsKind;
  capturedAt: string | null;
  availableAt: string | null;
  observationId: string;
  rawDocumentId: string;
};

export type N2FeatureDatasetBuildInput = {
  canonicalRaceKey: string;
  betType: SettlementBetType;
  decisionCutoff: string;
  mode: PITMode;
  eligibility: { eligible: boolean; reason: EligibilityCode };
  winningSelections: string[];
  payoutYenBySelection: Record<string, number>;
  refundedSelections?: string[];
  refundYenBySelection?: Record<string, number | null>;
  specialPayoutYenPer100?: number | null;
  features: N2FeatureObservation[];
  odds: N2OddsObservation[];
  requireOdds: boolean;
};

export type N2FeatureDatasetExclusion = {
  scope: "candidate" | "feature" | "odds";
  key: string;
  reason: string;
};

export type N2FeatureDatasetRow = {
  canonicalRaceKey: string;
  betType: SettlementBetType;
  betSelection: string;
  decisionCutoff: string;
  label: SelectionLevelLabel;
  features: Record<string, N2FeatureValue>;
  featureProvenance: Array<{
    featureKey: string;
    availableAt: string;
    observationId: string;
    rawDocumentId: string;
  }>;
  odds: null | {
    value: number;
    kind: "live_checkpoint";
    capturedAt: string;
    availableAt: string;
    observationId: string;
    rawDocumentId: string;
  };
  builderVersion: string;
};

export type N2FeatureDatasetBuildResult = {
  status: "built" | "excluded";
  rows: N2FeatureDatasetRow[];
  exclusions: N2FeatureDatasetExclusion[];
};

const LIVE_ONLY_KEYS = new Set<string>(LIVE_ONLY_FEATURE_KEYS);
const HISTORICAL_SAFE_KEYS = new Set<string>(HISTORICAL_SAFE_FEATURE_KEYS);

// known keyのclassをcallerが偽装してPIT guardを迂回することを禁止する。
function classificationMatches(feature: N2FeatureObservation): boolean {
  // boat.1.courseAvgSt のようなnamespaced keyでもbase keyを検査し、prefixによるlaunderingを防ぐ。
  const baseKey = feature.featureKey.split(".").at(-1) ?? feature.featureKey;
  if (LIVE_ONLY_KEYS.has(baseKey)) return feature.pitClass === "live_only";
  if (HISTORICAL_SAFE_KEYS.has(baseKey)) return feature.pitClass === "historical_safe";
  return true;
}

function exclude(scope: N2FeatureDatasetExclusion["scope"], key: string, reason: string): N2FeatureDatasetBuildResult {
  return { status: "excluded", rows: [], exclusions: [{ scope, key, reason }] };
}

// unsafe inputが一つでもあればcandidate全体をfail-closedにし、部分的な学習行を返さない。
export function buildN2FeatureDatasetRows(input: N2FeatureDatasetBuildInput): N2FeatureDatasetBuildResult {
  if (!input.eligibility.eligible) {
    return exclude("candidate", input.canonicalRaceKey, input.eligibility.reason);
  }

  const labels = deriveSelectionLevelLabels({
    betType: input.betType,
    eligibility: input.eligibility,
    winningSelections: input.winningSelections,
    payoutYenBySelection: input.payoutYenBySelection,
    refundedSelections: input.refundedSelections,
    refundYenBySelection: input.refundYenBySelection,
    specialPayoutYenPer100: input.specialPayoutYenPer100,
  });
  const canonicalSelections = new Set(labels.map((label) => label.betSelection));

  const featureKeys = new Set<string>();
  const features: Record<string, N2FeatureValue> = {};
  const featureProvenance: N2FeatureDatasetRow["featureProvenance"] = [];
  for (const feature of input.features) {
    if (featureKeys.has(feature.featureKey)) return exclude("feature", feature.featureKey, "excluded_duplicate_feature_key");
    featureKeys.add(feature.featureKey);
    if (!classificationMatches(feature)) return exclude("feature", feature.featureKey, "excluded_feature_class_mismatch");
    const pit = validateFeaturePIT(feature, input.decisionCutoff, input.mode);
    if (!pit.usable) return exclude("feature", feature.featureKey, pit.reason);
    if (!feature.observationId || !feature.rawDocumentId || feature.availableAt === null) {
      return exclude("feature", feature.featureKey, "excluded_missing_feature_provenance");
    }
    features[feature.featureKey] = feature.value;
    featureProvenance.push({
      featureKey: feature.featureKey,
      availableAt: feature.availableAt,
      observationId: feature.observationId,
      rawDocumentId: feature.rawDocumentId,
    });
  }

  const oddsBySelection = new Map<string, N2FeatureDatasetRow["odds"]>();
  for (const odds of input.odds) {
    if (!canonicalSelections.has(odds.betSelection)) return exclude("odds", odds.betSelection, "excluded_noncanonical_odds_selection");
    if (oddsBySelection.has(odds.betSelection)) return exclude("odds", odds.betSelection, "excluded_duplicate_odds_selection");
    if (!Number.isFinite(odds.odds) || odds.odds <= 0) return exclude("odds", odds.betSelection, "excluded_invalid_odds_value");
    const timing = validateOddsUsage({
      kind: odds.kind,
      role: "feature",
      capturedAt: odds.capturedAt,
      availableAt: odds.availableAt,
      decisionCutoff: input.decisionCutoff,
    });
    if (!timing.usable) return exclude("odds", odds.betSelection, timing.reason);
    if (!odds.observationId || !odds.rawDocumentId || odds.capturedAt === null || odds.availableAt === null) {
      return exclude("odds", odds.betSelection, "excluded_missing_odds_provenance");
    }
    oddsBySelection.set(odds.betSelection, {
      value: odds.odds,
      kind: "live_checkpoint",
      capturedAt: odds.capturedAt,
      availableAt: odds.availableAt,
      observationId: odds.observationId,
      rawDocumentId: odds.rawDocumentId,
    });
  }

  if (input.requireOdds) {
    const missing = labels.find((label) => !oddsBySelection.has(label.betSelection));
    if (missing) return exclude("odds", missing.betSelection, "excluded_missing_required_odds");
  }

  const stableFeatures = Object.fromEntries(Object.entries(features).sort(([a], [b]) => a.localeCompare(b)));
  const stableProvenance = [...featureProvenance].sort((a, b) => a.featureKey.localeCompare(b.featureKey));
  return {
    status: "built",
    exclusions: [],
    rows: labels.map((label) => ({
      canonicalRaceKey: input.canonicalRaceKey,
      betType: input.betType,
      betSelection: label.betSelection,
      decisionCutoff: input.decisionCutoff,
      label,
      features: { ...stableFeatures },
      featureProvenance: stableProvenance.map((item) => ({ ...item })),
      odds: oddsBySelection.get(label.betSelection) ?? null,
      builderVersion: N2_FEATURE_DATASET_BUILDER_VERSION,
    })),
  };
}

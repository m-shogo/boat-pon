import { canonicalHash } from "./canonical";
import {
  validateFeaturePIT,
  type FeaturePITClass,
  type N2EvaluationSplit,
} from "./n2DatasetContract";

export const N2_EDGE_HYPOTHESIS_SCAN_VERSION = "n2-edge-hypothesis-scan-v1" as const;
export const N2_EDGE_SCAN_ALPHA = 0.05;
export const N2_EDGE_SCAN_MIN_UNIQUE_RACES = 200;
export const N2_EDGE_SCAN_MIN_ABSOLUTE_RESIDUAL = 0.001;
export const N2_EDGE_SCAN_MAX_SIGNALS = 50;

export type N2EdgeFeatureFamily =
  | "course"
  | "player"
  | "start_timing"
  | "exhibition"
  | "motor_boat"
  | "weather";

export type N2EdgeFeatureSourceStatus =
  | "historical_safe_now"
  | "requires_verified_timed_adapter";

export type N2EdgeFeatureDefinition = {
  featureKey: string;
  family: N2EdgeFeatureFamily;
  valueType: "categorical" | "numeric";
  allowedCategories?: string[];
  cutPoints?: number[];
  sourceStatus: N2EdgeFeatureSourceStatus;
  expectedPitClass: FeaturePITClass;
  missingPolicy: "exclude_feature_value";
};

const RATE_CUTS = [0.3, 0.4, 0.5] as const;
const WIN_RATE_CUTS = [4.5, 5.5, 6.5] as const;

/**
 * Frozen v1 search space. It deliberately includes ST/exhibition/weather as
 * named research families, but marks them adapter-gated until a source proves
 * exact available_at <= decisionCutoff. Current racer snapshot fields are not
 * registered and therefore fail closed if a caller tries to inject them.
 */
export const N2_EDGE_FEATURE_DEFINITIONS: readonly N2EdgeFeatureDefinition[] = Object.freeze([
  {
    featureKey: "course",
    family: "course",
    valueType: "categorical",
    allowedCategories: ["1", "2", "3", "4", "5", "6"],
    sourceStatus: "historical_safe_now",
    expectedPitClass: "historical_safe",
    missingPolicy: "exclude_feature_value",
  },
  {
    featureKey: "className",
    family: "player",
    valueType: "categorical",
    allowedCategories: ["A1", "A2", "B1", "B2"],
    sourceStatus: "historical_safe_now",
    expectedPitClass: "historical_safe",
    missingPolicy: "exclude_feature_value",
  },
  ...[
    "nationalWinRate",
    "localWinRate",
  ].map((featureKey): N2EdgeFeatureDefinition => ({
    featureKey,
    family: "player",
    valueType: "numeric",
    cutPoints: [...WIN_RATE_CUTS],
    sourceStatus: "historical_safe_now",
    expectedPitClass: "historical_safe",
    missingPolicy: "exclude_feature_value",
  })),
  ...[
    "nationalTop2Rate",
    "localTop2Rate",
  ].map((featureKey): N2EdgeFeatureDefinition => ({
    featureKey,
    family: "player",
    valueType: "numeric",
    cutPoints: [...RATE_CUTS],
    sourceStatus: "historical_safe_now",
    expectedPitClass: "historical_safe",
    missingPolicy: "exclude_feature_value",
  })),
  ...[
    "motorTop2Rate",
    "boatTop2Rate",
    "venueMotorTop2Rate",
    "venueBoatTop2Rate",
  ].map((featureKey): N2EdgeFeatureDefinition => ({
    featureKey,
    family: "motor_boat",
    valueType: "numeric",
    cutPoints: [...RATE_CUTS],
    sourceStatus: "historical_safe_now",
    expectedPitClass: "historical_safe",
    missingPolicy: "exclude_feature_value",
  })),
  {
    featureKey: "startTiming",
    family: "start_timing",
    valueType: "numeric",
    cutPoints: [0.08, 0.12, 0.16, 0.2],
    sourceStatus: "requires_verified_timed_adapter",
    expectedPitClass: "historical_safe",
    missingPolicy: "exclude_feature_value",
  },
  {
    featureKey: "exhibitionRank",
    family: "exhibition",
    valueType: "numeric",
    cutPoints: [1.5, 2.5, 3.5, 4.5, 5.5],
    sourceStatus: "requires_verified_timed_adapter",
    expectedPitClass: "historical_safe",
    missingPolicy: "exclude_feature_value",
  },
  {
    featureKey: "windSpeedMps",
    family: "weather",
    valueType: "numeric",
    cutPoints: [2, 4, 6, 8],
    sourceStatus: "requires_verified_timed_adapter",
    expectedPitClass: "historical_safe",
    missingPolicy: "exclude_feature_value",
  },
  {
    featureKey: "waveHeightCm",
    family: "weather",
    valueType: "numeric",
    cutPoints: [2, 5, 10],
    sourceStatus: "requires_verified_timed_adapter",
    expectedPitClass: "historical_safe",
    missingPolicy: "exclude_feature_value",
  },
]);

export type N2EdgeFeatureObservation = {
  value: string | number | null;
  pitClass: FeaturePITClass;
  availableAt: string | null;
};

export type N2EdgeScanObservation = {
  canonicalRaceKey: string;
  split: N2EvaluationSplit;
  decisionCutoff: string;
  betSelection: string;
  hit: 0 | 1;
  baselineId: string;
  baselineProbability: number;
  features: Record<string, N2EdgeFeatureObservation>;
};

export type N2EdgeHypothesis = {
  hypothesisId: string;
  featureKey: string;
  family: N2EdgeFeatureFamily;
  bucket: string;
  direction: "underpredicted" | "overpredicted";
  uniqueRaceCount: number;
  meanResidual: number;
  standardError: number;
  zScore: number;
  rawPValue: number;
  holmAdjustedPValue: number;
  discoverySplit: "train";
  confirmationSplits: ["validation", "test"];
  forwardShadowReserved: true;
};

export type N2EdgeHypothesisScanReport = {
  scanVersion: typeof N2_EDGE_HYPOTHESIS_SCAN_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  baselineId: string | null;
  discoverySplit: "train";
  confirmationSplits: ["validation", "test"];
  forwardShadowReserved: true;
  interactionScanAllowed: false;
  featureDefinitionCount: number;
  historicalSafeFeatureCount: number;
  timedAdapterRequiredFeatureCount: number;
  inputObservationCount: number;
  pitExcludedFeatureValueCount: number;
  missingFeatureValueCount: number;
  testedHypothesisCount: number;
  signalCount: number;
  signals: N2EdgeHypothesis[];
  multipleTesting: {
    method: "Holm-Bonferroni";
    familyWiseAlpha: number;
    minUniqueRaces: number;
    minAbsoluteResidual: number;
    maxSignals: number;
  };
  authority: {
    roiUsedForDiscovery: false;
    payoutUsedForDiscovery: false;
    validationLabelsUsedForDiscovery: false;
    testLabelsUsedForDiscovery: false;
    forwardLabelsUsedForDiscovery: false;
    automaticPromotionAuthorized: false;
    currentBuyConnectionAuthorized: false;
    lineConnectionAuthorized: false;
    publicPublishAuthorized: false;
    automatedBettingAuthorized: false;
    productionApplyAuthorized: false;
  };
  outputDigest: string;
};

type BucketAggregate = {
  definition: N2EdgeFeatureDefinition;
  bucket: string;
  raceResiduals: Map<string, number[]>;
};

type RawTest = Omit<N2EdgeHypothesis, "hypothesisId" | "holmAdjustedPValue">;

function normalCdf(value: number): number {
  // Abramowitz-Stegun approximation, deterministic and sufficient for screening.
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = sign * (1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

function twoSidedNormalP(zScore: number): number {
  if (!Number.isFinite(zScore)) return 1;
  return Math.min(1, Math.max(0, 2 * (1 - normalCdf(Math.abs(zScore)))));
}

function numericBucket(value: number, cutPoints: number[]): string {
  for (let index = 0; index < cutPoints.length; index += 1) {
    if (value < cutPoints[index]) {
      return index === 0
        ? `<${cutPoints[index]}`
        : `[${cutPoints[index - 1]},${cutPoints[index]})`;
    }
  }
  return `>=${cutPoints[cutPoints.length - 1]}`;
}

function bucketFor(definition: N2EdgeFeatureDefinition, value: string | number): string | null {
  if (definition.valueType === "categorical") {
    const normalized = String(value);
    return definition.allowedCategories?.includes(normalized) ? normalized : null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const cutPoints = definition.cutPoints ?? [];
  return cutPoints.length > 0 ? numericBucket(value, cutPoints) : null;
}

function reportBlocked(blockers: string[], inputCount: number): N2EdgeHypothesisScanReport {
  const core = {
    scanVersion: N2_EDGE_HYPOTHESIS_SCAN_VERSION,
    status: "BLOCKED" as const,
    blockers: [...new Set(blockers)].sort(),
    baselineId: null,
    discoverySplit: "train" as const,
    confirmationSplits: ["validation", "test"] as ["validation", "test"],
    forwardShadowReserved: true as const,
    interactionScanAllowed: false as const,
    featureDefinitionCount: N2_EDGE_FEATURE_DEFINITIONS.length,
    historicalSafeFeatureCount: N2_EDGE_FEATURE_DEFINITIONS.filter((item) => item.sourceStatus === "historical_safe_now").length,
    timedAdapterRequiredFeatureCount: N2_EDGE_FEATURE_DEFINITIONS.filter((item) => item.sourceStatus === "requires_verified_timed_adapter").length,
    inputObservationCount: inputCount,
    pitExcludedFeatureValueCount: 0,
    missingFeatureValueCount: 0,
    testedHypothesisCount: 0,
    signalCount: 0,
    signals: [] as N2EdgeHypothesis[],
    multipleTesting: {
      method: "Holm-Bonferroni" as const,
      familyWiseAlpha: N2_EDGE_SCAN_ALPHA,
      minUniqueRaces: N2_EDGE_SCAN_MIN_UNIQUE_RACES,
      minAbsoluteResidual: N2_EDGE_SCAN_MIN_ABSOLUTE_RESIDUAL,
      maxSignals: N2_EDGE_SCAN_MAX_SIGNALS,
    },
    authority: {
      roiUsedForDiscovery: false as const,
      payoutUsedForDiscovery: false as const,
      validationLabelsUsedForDiscovery: false as const,
      testLabelsUsedForDiscovery: false as const,
      forwardLabelsUsedForDiscovery: false as const,
      automaticPromotionAuthorized: false as const,
      currentBuyConnectionAuthorized: false as const,
      lineConnectionAuthorized: false as const,
      publicPublishAuthorized: false as const,
      automatedBettingAuthorized: false as const,
      productionApplyAuthorized: false as const,
    },
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

export function scanN2EdgeHypotheses(observations: N2EdgeScanObservation[]): N2EdgeHypothesisScanReport {
  if (observations.length === 0) return reportBlocked(["NO_DISCOVERY_OBSERVATIONS"], 0);

  const blockers: string[] = [];
  const baselineIds = new Set<string>();
  const knownFeatureKeys = new Set(N2_EDGE_FEATURE_DEFINITIONS.map((definition) => definition.featureKey));
  for (const observation of observations) {
    baselineIds.add(observation.baselineId);
    if (observation.split !== "train") blockers.push(`NON_DISCOVERY_SPLIT_PRESENT:${observation.split}`);
    if (!Number.isFinite(Date.parse(observation.decisionCutoff))) blockers.push("INVALID_DECISION_CUTOFF");
    if (!Number.isFinite(observation.baselineProbability)
      || observation.baselineProbability < 0
      || observation.baselineProbability > 1) blockers.push("INVALID_BASELINE_PROBABILITY");
    if (observation.hit !== 0 && observation.hit !== 1) blockers.push("INVALID_HIT_LABEL");
    for (const featureKey of Object.keys(observation.features)) {
      if (!knownFeatureKeys.has(featureKey)) blockers.push(`UNKNOWN_FEATURE_KEY:${featureKey}`);
    }
  }
  if (baselineIds.size !== 1) blockers.push(`BASELINE_ID_COUNT:${baselineIds.size}/1`);
  if (blockers.length > 0) return reportBlocked(blockers, observations.length);

  const aggregates = new Map<string, BucketAggregate>();
  let pitExcludedFeatureValueCount = 0;
  let missingFeatureValueCount = 0;

  for (const observation of observations) {
    const residual = observation.hit - observation.baselineProbability;
    for (const definition of N2_EDGE_FEATURE_DEFINITIONS) {
      const feature = observation.features[definition.featureKey];
      if (feature == null || feature.value == null) {
        missingFeatureValueCount += 1;
        continue;
      }
      if (feature.pitClass !== definition.expectedPitClass) {
        pitExcludedFeatureValueCount += 1;
        continue;
      }
      const pit = validateFeaturePIT({
        featureKey: definition.featureKey,
        pitClass: feature.pitClass,
        availableAt: feature.availableAt,
      }, observation.decisionCutoff, "historical");
      if (!pit.usable) {
        pitExcludedFeatureValueCount += 1;
        continue;
      }
      const bucket = bucketFor(definition, feature.value);
      if (bucket === null) {
        missingFeatureValueCount += 1;
        continue;
      }
      const aggregateKey = `${definition.featureKey}|${bucket}`;
      const aggregate = aggregates.get(aggregateKey) ?? {
        definition,
        bucket,
        raceResiduals: new Map<string, number[]>(),
      };
      const perRace = aggregate.raceResiduals.get(observation.canonicalRaceKey) ?? [];
      perRace.push(residual);
      aggregate.raceResiduals.set(observation.canonicalRaceKey, perRace);
      aggregates.set(aggregateKey, aggregate);
    }
  }

  const rawTests: RawTest[] = [];
  for (const aggregate of aggregates.values()) {
    const raceMeans = [...aggregate.raceResiduals.values()].map((values) =>
      values.reduce((sum, value) => sum + value, 0) / values.length,
    );
    if (raceMeans.length < N2_EDGE_SCAN_MIN_UNIQUE_RACES) continue;
    const meanResidual = raceMeans.reduce((sum, value) => sum + value, 0) / raceMeans.length;
    const variance = raceMeans.length <= 1
      ? 0
      : raceMeans.reduce((sum, value) => sum + ((value - meanResidual) ** 2), 0) / (raceMeans.length - 1);
    const standardError = Math.sqrt(variance / raceMeans.length);
    const zScore = standardError > 0 ? meanResidual / standardError : 0;
    rawTests.push({
      featureKey: aggregate.definition.featureKey,
      family: aggregate.definition.family,
      bucket: aggregate.bucket,
      direction: meanResidual >= 0 ? "underpredicted" : "overpredicted",
      uniqueRaceCount: raceMeans.length,
      meanResidual,
      standardError,
      zScore,
      rawPValue: twoSidedNormalP(zScore),
      discoverySplit: "train",
      confirmationSplits: ["validation", "test"],
      forwardShadowReserved: true,
    });
  }

  const ordered = [...rawTests].sort((left, right) =>
    left.rawPValue - right.rawPValue
    || left.featureKey.localeCompare(right.featureKey)
    || left.bucket.localeCompare(right.bucket),
  );
  let priorAdjusted = 0;
  const adjusted: N2EdgeHypothesis[] = ordered.map((test, index) => {
    const adjustedP = Math.min(1, Math.max(priorAdjusted, test.rawPValue * (ordered.length - index)));
    priorAdjusted = adjustedP;
    const identity = {
      scanVersion: N2_EDGE_HYPOTHESIS_SCAN_VERSION,
      featureKey: test.featureKey,
      bucket: test.bucket,
      direction: test.direction,
      discoverySplit: test.discoverySplit,
      confirmationSplits: test.confirmationSplits,
    };
    return {
      ...test,
      hypothesisId: `N2EDGE-${canonicalHash(identity).slice(0, 16)}`,
      holmAdjustedPValue: adjustedP,
    };
  });

  const signals = adjusted
    .filter((test) => test.holmAdjustedPValue <= N2_EDGE_SCAN_ALPHA
      && Math.abs(test.meanResidual) >= N2_EDGE_SCAN_MIN_ABSOLUTE_RESIDUAL)
    .sort((left, right) =>
      left.holmAdjustedPValue - right.holmAdjustedPValue
      || Math.abs(right.meanResidual) - Math.abs(left.meanResidual)
      || left.hypothesisId.localeCompare(right.hypothesisId),
    )
    .slice(0, N2_EDGE_SCAN_MAX_SIGNALS);

  const core = {
    scanVersion: N2_EDGE_HYPOTHESIS_SCAN_VERSION,
    status: "PASS" as const,
    blockers: [] as string[],
    baselineId: [...baselineIds][0],
    discoverySplit: "train" as const,
    confirmationSplits: ["validation", "test"] as ["validation", "test"],
    forwardShadowReserved: true as const,
    interactionScanAllowed: false as const,
    featureDefinitionCount: N2_EDGE_FEATURE_DEFINITIONS.length,
    historicalSafeFeatureCount: N2_EDGE_FEATURE_DEFINITIONS.filter((item) => item.sourceStatus === "historical_safe_now").length,
    timedAdapterRequiredFeatureCount: N2_EDGE_FEATURE_DEFINITIONS.filter((item) => item.sourceStatus === "requires_verified_timed_adapter").length,
    inputObservationCount: observations.length,
    pitExcludedFeatureValueCount,
    missingFeatureValueCount,
    testedHypothesisCount: adjusted.length,
    signalCount: signals.length,
    signals,
    multipleTesting: {
      method: "Holm-Bonferroni" as const,
      familyWiseAlpha: N2_EDGE_SCAN_ALPHA,
      minUniqueRaces: N2_EDGE_SCAN_MIN_UNIQUE_RACES,
      minAbsoluteResidual: N2_EDGE_SCAN_MIN_ABSOLUTE_RESIDUAL,
      maxSignals: N2_EDGE_SCAN_MAX_SIGNALS,
    },
    authority: {
      roiUsedForDiscovery: false as const,
      payoutUsedForDiscovery: false as const,
      validationLabelsUsedForDiscovery: false as const,
      testLabelsUsedForDiscovery: false as const,
      forwardLabelsUsedForDiscovery: false as const,
      automaticPromotionAuthorized: false as const,
      currentBuyConnectionAuthorized: false as const,
      lineConnectionAuthorized: false as const,
      publicPublishAuthorized: false as const,
      automatedBettingAuthorized: false as const,
      productionApplyAuthorized: false as const,
    },
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

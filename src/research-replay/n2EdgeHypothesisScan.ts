import { canonicalHash } from "./canonical";
import {
  enumerateBetSelections,
  validateFeaturePIT,
  type FeaturePITClass,
} from "./n2DatasetContract";
import {
  splitForN2RaceKey,
  type N2EvaluationSplit,
} from "./n2BaselineEvaluation";

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
export type N2EdgeSelectionRole = "first" | "second" | "third" | "race";
export type N2EdgeFeatureSourceStatus =
  | "derived_from_selection"
  | "historical_safe_now"
  | "requires_verified_timed_adapter";

export type N2EdgeFeatureDefinition = {
  featureKey: string;
  family: N2EdgeFeatureFamily;
  selectionRole: N2EdgeSelectionRole;
  valueType: "categorical" | "numeric";
  allowedCategories?: string[];
  cutPoints?: number[];
  sourceStatus: N2EdgeFeatureSourceStatus;
  expectedPitClass: FeaturePITClass;
  missingPolicy: "exclude_feature_value";
};

const TOP2_RATE_PERCENT_CUTS = [30, 40, 50] as const;
const WIN_RATE_CUTS = [4.5, 5.5, 6.5] as const;
const TRIFECTA_SELECTIONS = new Set(enumerateBetSelections("trifecta"));
const SELECTION_ROLES = ["first", "second", "third"] as const;

function roleFeature(
  role: Exclude<N2EdgeSelectionRole, "race">,
  suffix: string,
  family: N2EdgeFeatureFamily,
  valueType: N2EdgeFeatureDefinition["valueType"],
  options: Pick<N2EdgeFeatureDefinition, "sourceStatus" | "expectedPitClass"> & {
    allowedCategories?: string[];
    cutPoints?: number[];
  },
): N2EdgeFeatureDefinition {
  return {
    featureKey: `${role}${suffix}`,
    family,
    selectionRole: role,
    valueType,
    allowedCategories: options.allowedCategories,
    cutPoints: options.cutPoints,
    sourceStatus: options.sourceStatus,
    expectedPitClass: options.expectedPitClass,
    missingPolicy: "exclude_feature_value",
  };
}

/**
 * Frozen v1 search space. Every selection-dependent feature has an explicit
 * first/second/third role so a later source adapter cannot silently change its
 * meaning. Course is derived from the canonical trifecta selection itself.
 * Current racer snapshots are intentionally absent. ST/exhibition/weather are
 * represented but gated behind separately reviewed, exact pre-cutoff adapters.
 */
export const N2_EDGE_FEATURE_DEFINITIONS: readonly N2EdgeFeatureDefinition[] = Object.freeze([
  ...SELECTION_ROLES.map((role) => roleFeature(role, "Course", "course", "categorical", {
    allowedCategories: ["1", "2", "3", "4", "5", "6"],
    sourceStatus: "derived_from_selection",
    expectedPitClass: "historical_safe",
  })),
  ...SELECTION_ROLES.flatMap((role) => [
    roleFeature(role, "ClassName", "player", "categorical", {
      allowedCategories: ["A1", "A2", "B1", "B2"],
      sourceStatus: "historical_safe_now",
      expectedPitClass: "historical_safe",
    }),
    roleFeature(role, "NationalWinRate", "player", "numeric", {
      cutPoints: [...WIN_RATE_CUTS],
      sourceStatus: "historical_safe_now",
      expectedPitClass: "historical_safe",
    }),
    roleFeature(role, "LocalWinRate", "player", "numeric", {
      cutPoints: [...WIN_RATE_CUTS],
      sourceStatus: "historical_safe_now",
      expectedPitClass: "historical_safe",
    }),
    roleFeature(role, "NationalTop2Rate", "player", "numeric", {
      cutPoints: [...TOP2_RATE_PERCENT_CUTS],
      sourceStatus: "historical_safe_now",
      expectedPitClass: "historical_safe",
    }),
    roleFeature(role, "LocalTop2Rate", "player", "numeric", {
      cutPoints: [...TOP2_RATE_PERCENT_CUTS],
      sourceStatus: "historical_safe_now",
      expectedPitClass: "historical_safe",
    }),
    roleFeature(role, "MotorTop2Rate", "motor_boat", "numeric", {
      cutPoints: [...TOP2_RATE_PERCENT_CUTS],
      sourceStatus: "historical_safe_now",
      expectedPitClass: "historical_safe",
    }),
    roleFeature(role, "BoatTop2Rate", "motor_boat", "numeric", {
      cutPoints: [...TOP2_RATE_PERCENT_CUTS],
      sourceStatus: "historical_safe_now",
      expectedPitClass: "historical_safe",
    }),
    roleFeature(role, "VenueMotorTop2Rate", "motor_boat", "numeric", {
      cutPoints: [...TOP2_RATE_PERCENT_CUTS],
      sourceStatus: "historical_safe_now",
      expectedPitClass: "historical_safe",
    }),
    roleFeature(role, "VenueBoatTop2Rate", "motor_boat", "numeric", {
      cutPoints: [...TOP2_RATE_PERCENT_CUTS],
      sourceStatus: "historical_safe_now",
      expectedPitClass: "historical_safe",
    }),
    roleFeature(role, "StartTiming", "start_timing", "numeric", {
      cutPoints: [0.08, 0.12, 0.16, 0.2],
      sourceStatus: "requires_verified_timed_adapter",
      expectedPitClass: "historical_safe",
    }),
    roleFeature(role, "ExhibitionRank", "exhibition", "numeric", {
      cutPoints: [1.5, 2.5, 3.5, 4.5, 5.5],
      sourceStatus: "requires_verified_timed_adapter",
      expectedPitClass: "historical_safe",
    }),
  ]),
  {
    featureKey: "windSpeedMps",
    family: "weather",
    selectionRole: "race",
    valueType: "numeric",
    cutPoints: [2, 4, 6, 8],
    sourceStatus: "requires_verified_timed_adapter",
    expectedPitClass: "historical_safe",
    missingPolicy: "exclude_feature_value",
  },
  {
    featureKey: "waveHeightCm",
    family: "weather",
    selectionRole: "race",
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
  adapterId?: string | null;
  adapterVerified?: boolean;
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
  selectionRole: N2EdgeSelectionRole;
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
  derivedFeatureCount: number;
  historicalSafeFeatureCount: number;
  timedAdapterRequiredFeatureCount: number;
  inputObservationCount: number;
  pitExcludedFeatureValueCount: number;
  adapterGatedFeatureValueCount: number;
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

type RaceBucket = {
  definition: N2EdgeFeatureDefinition;
  bucket: string;
  residualSum: number;
  residualCount: number;
};

type OnlineAggregate = {
  definition: N2EdgeFeatureDefinition;
  bucket: string;
  uniqueRaceCount: number;
  mean: number;
  m2: number;
};

type RawTest = Omit<N2EdgeHypothesis, "hypothesisId" | "holmAdjustedPValue">;

function normalCdf(value: number): number {
  if (value === Number.POSITIVE_INFINITY) return 1;
  if (value === Number.NEGATIVE_INFINITY) return 0;
  if (!Number.isFinite(value)) return Number.NaN;
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
  if (Number.isNaN(zScore)) return 1;
  if (Math.abs(zScore) === Number.POSITIVE_INFINITY) return 0;
  return Math.min(1, Math.max(0, 2 * (1 - normalCdf(Math.abs(zScore)))));
}

function numericBucket(value: number, cutPoints: number[]): string {
  for (let index = 0; index < cutPoints.length; index += 1) {
    if (value < cutPoints[index]) {
      return index === 0 ? `<${cutPoints[index]}` : `[${cutPoints[index - 1]},${cutPoints[index]})`;
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

function derivedSelectionFeature(
  definition: N2EdgeFeatureDefinition,
  betSelection: string,
  decisionCutoff: string,
): N2EdgeFeatureObservation | null {
  if (definition.sourceStatus !== "derived_from_selection") return null;
  const index = definition.selectionRole === "first" ? 0 : definition.selectionRole === "second" ? 1 : 2;
  const parts = betSelection.split("-");
  const value = parts[index];
  return value == null ? null : {
    value,
    pitClass: "historical_safe",
    availableAt: decisionCutoff,
    adapterId: "canonical-trifecta-selection-v1",
    adapterVerified: true,
  };
}

function compareRaceKeys(left: string, right: string): number {
  if (left === right) return 0;
  return left.localeCompare(right);
}

function commonReportFields(inputCount: number) {
  return {
    discoverySplit: "train" as const,
    confirmationSplits: ["validation", "test"] as ["validation", "test"],
    forwardShadowReserved: true as const,
    interactionScanAllowed: false as const,
    featureDefinitionCount: N2_EDGE_FEATURE_DEFINITIONS.length,
    derivedFeatureCount: N2_EDGE_FEATURE_DEFINITIONS.filter((item) => item.sourceStatus === "derived_from_selection").length,
    historicalSafeFeatureCount: N2_EDGE_FEATURE_DEFINITIONS.filter((item) => item.sourceStatus === "historical_safe_now").length,
    timedAdapterRequiredFeatureCount: N2_EDGE_FEATURE_DEFINITIONS.filter((item) => item.sourceStatus === "requires_verified_timed_adapter").length,
    inputObservationCount: inputCount,
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
}

function reportBlocked(input: {
  blockers: string[];
  inputCount: number;
  pitExcludedFeatureValueCount?: number;
  adapterGatedFeatureValueCount?: number;
  missingFeatureValueCount?: number;
}): N2EdgeHypothesisScanReport {
  const core = {
    scanVersion: N2_EDGE_HYPOTHESIS_SCAN_VERSION,
    status: "BLOCKED" as const,
    blockers: [...new Set(input.blockers)].sort(),
    baselineId: null,
    ...commonReportFields(input.inputCount),
    pitExcludedFeatureValueCount: input.pitExcludedFeatureValueCount ?? 0,
    adapterGatedFeatureValueCount: input.adapterGatedFeatureValueCount ?? 0,
    missingFeatureValueCount: input.missingFeatureValueCount ?? 0,
    testedHypothesisCount: 0,
    signalCount: 0,
    signals: [] as N2EdgeHypothesis[],
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

export class N2EdgeHypothesisAccumulator {
  private readonly knownFeatureKeys = new Set(N2_EDGE_FEATURE_DEFINITIONS.map((definition) => definition.featureKey));
  private readonly blockers: string[] = [];
  private readonly baselineIds = new Set<string>();
  private readonly aggregates = new Map<string, OnlineAggregate>();
  private currentRaceKey: string | null = null;
  private currentRaceBuckets = new Map<string, RaceBucket>();
  private currentRaceSelections = new Set<string>();
  private inputObservationCount = 0;
  private pitExcludedFeatureValueCount = 0;
  private adapterGatedFeatureValueCount = 0;
  private missingFeatureValueCount = 0;

  add(observation: N2EdgeScanObservation): void {
    this.inputObservationCount += 1;
    this.baselineIds.add(observation.baselineId);

    const canonicalSplit = splitForN2RaceKey(observation.canonicalRaceKey);
    const observationBlockers: string[] = [];
    if (canonicalSplit === null) observationBlockers.push(`INVALID_RACE_KEY:${observation.canonicalRaceKey}`);
    else if (observation.split !== canonicalSplit) observationBlockers.push(`SPLIT_MISMATCH:${observation.canonicalRaceKey}:${observation.split}/${canonicalSplit}`);
    if (observation.split !== "train") observationBlockers.push(`NON_DISCOVERY_SPLIT_PRESENT:${observation.split}`);
    if (!Number.isFinite(Date.parse(observation.decisionCutoff))) observationBlockers.push("INVALID_DECISION_CUTOFF");
    if (!TRIFECTA_SELECTIONS.has(observation.betSelection)) observationBlockers.push(`INVALID_TRIFECTA_SELECTION:${observation.betSelection}`);
    if (!Number.isFinite(observation.baselineProbability)
      || observation.baselineProbability < 0
      || observation.baselineProbability > 1) observationBlockers.push("INVALID_BASELINE_PROBABILITY");
    if (observation.hit !== 0 && observation.hit !== 1) observationBlockers.push("INVALID_HIT_LABEL");
    for (const featureKey of Object.keys(observation.features)) {
      if (!this.knownFeatureKeys.has(featureKey)) observationBlockers.push(`UNKNOWN_FEATURE_KEY:${featureKey}`);
    }

    if (this.currentRaceKey !== null && compareRaceKeys(observation.canonicalRaceKey, this.currentRaceKey) < 0) {
      observationBlockers.push(`STREAM_ORDER_REGRESSION:${observation.canonicalRaceKey}<${this.currentRaceKey}`);
    }
    if (this.currentRaceKey !== observation.canonicalRaceKey) {
      this.flushCurrentRace();
      this.currentRaceKey = observation.canonicalRaceKey;
      this.currentRaceBuckets = new Map();
      this.currentRaceSelections = new Set();
    }
    if (this.currentRaceSelections.has(observation.betSelection)) {
      observationBlockers.push(`DUPLICATE_OBSERVATION:${observation.canonicalRaceKey}:${observation.betSelection}`);
    }
    this.currentRaceSelections.add(observation.betSelection);

    if (observationBlockers.length > 0) {
      this.blockers.push(...observationBlockers);
      return;
    }

    const residual = observation.hit - observation.baselineProbability;
    for (const definition of N2_EDGE_FEATURE_DEFINITIONS) {
      const feature = derivedSelectionFeature(definition, observation.betSelection, observation.decisionCutoff)
        ?? observation.features[definition.featureKey];
      if (feature == null || feature.value == null) {
        this.missingFeatureValueCount += 1;
        continue;
      }
      if (definition.sourceStatus === "requires_verified_timed_adapter"
        && (feature.adapterVerified !== true || !feature.adapterId?.trim())) {
        this.adapterGatedFeatureValueCount += 1;
        continue;
      }
      if (feature.pitClass !== definition.expectedPitClass) {
        this.pitExcludedFeatureValueCount += 1;
        continue;
      }
      const pit = validateFeaturePIT({
        featureKey: definition.featureKey,
        pitClass: feature.pitClass,
        availableAt: feature.availableAt,
      }, observation.decisionCutoff, "historical");
      if (!pit.usable) {
        this.pitExcludedFeatureValueCount += 1;
        continue;
      }
      const bucket = bucketFor(definition, feature.value);
      if (bucket === null) {
        this.missingFeatureValueCount += 1;
        continue;
      }
      const key = `${definition.featureKey}|${bucket}`;
      const raceBucket = this.currentRaceBuckets.get(key) ?? {
        definition,
        bucket,
        residualSum: 0,
        residualCount: 0,
      };
      raceBucket.residualSum += residual;
      raceBucket.residualCount += 1;
      this.currentRaceBuckets.set(key, raceBucket);
    }
  }

  finalize(): N2EdgeHypothesisScanReport {
    this.flushCurrentRace();
    if (this.inputObservationCount === 0) {
      return reportBlocked({ blockers: ["NO_DISCOVERY_OBSERVATIONS"], inputCount: 0 });
    }
    if (this.baselineIds.size !== 1) this.blockers.push(`BASELINE_ID_COUNT:${this.baselineIds.size}/1`);
    if (this.blockers.length > 0) {
      return reportBlocked({
        blockers: this.blockers,
        inputCount: this.inputObservationCount,
        pitExcludedFeatureValueCount: this.pitExcludedFeatureValueCount,
        adapterGatedFeatureValueCount: this.adapterGatedFeatureValueCount,
        missingFeatureValueCount: this.missingFeatureValueCount,
      });
    }

    const rawTests: RawTest[] = [];
    for (const aggregate of this.aggregates.values()) {
      if (aggregate.uniqueRaceCount < N2_EDGE_SCAN_MIN_UNIQUE_RACES) continue;
      const variance = aggregate.uniqueRaceCount <= 1
        ? 0
        : aggregate.m2 / (aggregate.uniqueRaceCount - 1);
      const standardError = Math.sqrt(variance / aggregate.uniqueRaceCount);
      const zScore = standardError > 0
        ? aggregate.mean / standardError
        : aggregate.mean === 0 ? 0 : Math.sign(aggregate.mean) * Number.POSITIVE_INFINITY;
      rawTests.push({
        featureKey: aggregate.definition.featureKey,
        family: aggregate.definition.family,
        selectionRole: aggregate.definition.selectionRole,
        bucket: aggregate.bucket,
        direction: aggregate.mean >= 0 ? "underpredicted" : "overpredicted",
        uniqueRaceCount: aggregate.uniqueRaceCount,
        meanResidual: aggregate.mean,
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
    const adjusted: N2EdgeHypothesis[] = ordered.map((candidate, index) => {
      const adjustedP = Math.min(1, Math.max(priorAdjusted, candidate.rawPValue * (ordered.length - index)));
      priorAdjusted = adjustedP;
      const identity = {
        scanVersion: N2_EDGE_HYPOTHESIS_SCAN_VERSION,
        featureKey: candidate.featureKey,
        selectionRole: candidate.selectionRole,
        bucket: candidate.bucket,
        direction: candidate.direction,
        discoverySplit: candidate.discoverySplit,
        confirmationSplits: candidate.confirmationSplits,
      };
      return {
        ...candidate,
        hypothesisId: `N2EDGE-${canonicalHash(identity).slice(0, 16)}`,
        holmAdjustedPValue: adjustedP,
      };
    });
    const signals = adjusted
      .filter((candidate) => candidate.holmAdjustedPValue <= N2_EDGE_SCAN_ALPHA
        && Math.abs(candidate.meanResidual) >= N2_EDGE_SCAN_MIN_ABSOLUTE_RESIDUAL)
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
      baselineId: [...this.baselineIds][0],
      ...commonReportFields(this.inputObservationCount),
      pitExcludedFeatureValueCount: this.pitExcludedFeatureValueCount,
      adapterGatedFeatureValueCount: this.adapterGatedFeatureValueCount,
      missingFeatureValueCount: this.missingFeatureValueCount,
      testedHypothesisCount: adjusted.length,
      signalCount: signals.length,
      signals,
    };
    return { ...core, outputDigest: canonicalHash(core) };
  }

  private flushCurrentRace(): void {
    if (this.currentRaceKey === null || this.currentRaceBuckets.size === 0) return;
    for (const [key, raceBucket] of this.currentRaceBuckets.entries()) {
      if (raceBucket.residualCount <= 0) continue;
      const raceMean = raceBucket.residualSum / raceBucket.residualCount;
      const aggregate = this.aggregates.get(key) ?? {
        definition: raceBucket.definition,
        bucket: raceBucket.bucket,
        uniqueRaceCount: 0,
        mean: 0,
        m2: 0,
      };
      aggregate.uniqueRaceCount += 1;
      const delta = raceMean - aggregate.mean;
      aggregate.mean += delta / aggregate.uniqueRaceCount;
      const delta2 = raceMean - aggregate.mean;
      aggregate.m2 += delta * delta2;
      this.aggregates.set(key, aggregate);
    }
  }
}

export function createN2EdgeHypothesisAccumulator(): N2EdgeHypothesisAccumulator {
  return new N2EdgeHypothesisAccumulator();
}

export function scanN2EdgeHypotheses(observations: N2EdgeScanObservation[]): N2EdgeHypothesisScanReport {
  const accumulator = createN2EdgeHypothesisAccumulator();
  const ordered = [...observations].sort((left, right) =>
    left.canonicalRaceKey.localeCompare(right.canonicalRaceKey)
    || left.betSelection.localeCompare(right.betSelection)
    || left.baselineId.localeCompare(right.baselineId),
  );
  for (const observation of ordered) accumulator.add(observation);
  return accumulator.finalize();
}

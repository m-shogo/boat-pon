import {
  N2_EDGE_FEATURE_DEFINITIONS,
  type N2EdgeFeatureDefinition,
  type N2EdgeFeatureObservation,
} from "./n2EdgeHypothesisScan";
import { validateFeaturePIT } from "./n2DatasetContract";

const DEFINITION_BY_KEY = new Map(
  N2_EDGE_FEATURE_DEFINITIONS.map((definition) => [definition.featureKey, definition]),
);

export type N2EdgeFeatureBucketResolution = {
  status: "MATCHED" | "MISSING" | "PIT_BLOCKED" | "ADAPTER_BLOCKED" | "INVALID_VALUE" | "UNKNOWN_FEATURE";
  featureKey: string;
  bucket: string | null;
};

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

function derivedCourseValue(
  definition: N2EdgeFeatureDefinition,
  betSelection: string,
): string | null {
  if (definition.sourceStatus !== "derived_from_selection") return null;
  const parts = betSelection.split("-");
  const index = definition.selectionRole === "first" ? 0
    : definition.selectionRole === "second" ? 1
      : definition.selectionRole === "third" ? 2 : -1;
  return index >= 0 ? parts[index] ?? null : null;
}

/**
 * Resolve a locked N2 edge feature into the exact v1 bucket used by discovery.
 * The feature definition registry remains the single source of bucket cuts and
 * adapter/PIT requirements. Holdout confirmation must call this function rather
 * than inventing new bins.
 */
export function resolveN2EdgeFeatureBucket(input: {
  featureKey: string;
  betSelection: string;
  decisionCutoff: string;
  features: Record<string, N2EdgeFeatureObservation>;
}): N2EdgeFeatureBucketResolution {
  const definition = DEFINITION_BY_KEY.get(input.featureKey);
  if (!definition) return { status: "UNKNOWN_FEATURE", featureKey: input.featureKey, bucket: null };

  const derived = derivedCourseValue(definition, input.betSelection);
  if (derived !== null) {
    const bucket = bucketFor(definition, derived);
    return { status: bucket === null ? "INVALID_VALUE" : "MATCHED", featureKey: input.featureKey, bucket };
  }

  const feature = input.features[input.featureKey];
  if (feature == null || feature.value == null) {
    return { status: "MISSING", featureKey: input.featureKey, bucket: null };
  }
  if (definition.sourceStatus === "requires_verified_timed_adapter"
    && (feature.adapterVerified !== true || !feature.adapterId?.trim())) {
    return { status: "ADAPTER_BLOCKED", featureKey: input.featureKey, bucket: null };
  }
  if (feature.pitClass !== definition.expectedPitClass) {
    return { status: "PIT_BLOCKED", featureKey: input.featureKey, bucket: null };
  }
  const pit = validateFeaturePIT({
    featureKey: definition.featureKey,
    pitClass: feature.pitClass,
    availableAt: feature.availableAt,
  }, input.decisionCutoff, "historical");
  if (!pit.usable) return { status: "PIT_BLOCKED", featureKey: input.featureKey, bucket: null };

  const bucket = bucketFor(definition, feature.value);
  return { status: bucket === null ? "INVALID_VALUE" : "MATCHED", featureKey: input.featureKey, bucket };
}

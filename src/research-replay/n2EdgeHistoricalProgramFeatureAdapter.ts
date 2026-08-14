import {
  HISTORICAL_SAFE_FEATURE_KEYS,
  classifyProgramFeatureSafety,
  type HistoricalProgramFeatureUsageMode,
} from "../domain/programFeatureSafety";
import type { BoatFeature, ProgramFeatureSnapshot } from "../domain/programFeatures";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import { enumerateBetSelections } from "./n2DatasetContract";
import type { N2EdgeFeatureObservation } from "./n2EdgeHypothesisScan";

export const N2_EDGE_HISTORICAL_PROGRAM_ADAPTER_VERSION =
  "n2-edge-historical-program-adapter-v1" as const;
export const N2_EDGE_PROGRAM_AVAILABILITY_ADAPTER_ID =
  "official-program-race-scoped-preclose-upper-bound-v1" as const;

const TRIFECTA_SELECTIONS = new Set(enumerateBetSelections("trifecta"));
const ROLES = ["first", "second", "third"] as const;
type Role = typeof ROLES[number];

const ROLE_FIELD_MAPPING = [
  ["ClassName", "className"],
  ["NationalWinRate", "nationalWinRate"],
  ["NationalTop2Rate", "nationalTop2Rate"],
  ["LocalWinRate", "localWinRate"],
  ["LocalTop2Rate", "localTop2Rate"],
  ["MotorTop2Rate", "motorTop2Rate"],
  ["BoatTop2Rate", "boatTop2Rate"],
  ["VenueMotorTop2Rate", "venueMotorTop2Rate"],
  ["VenueBoatTop2Rate", "venueBoatTop2Rate"],
] as const satisfies ReadonlyArray<readonly [string, keyof BoatFeature]>;

export type N2EdgeHistoricalProgramAdapterResult = {
  adapterVersion: typeof N2_EDGE_HISTORICAL_PROGRAM_ADAPTER_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  betSelection: string;
  featureMode: HistoricalProgramFeatureUsageMode;
  mappedFeatureCount: number;
  nullFeatureCount: number;
  selectedBoatCount: number;
  sourceEvidence: {
    sourceClass: "official_program_plus_race_scoped_motor_boat";
    availabilityPolicy: "conservative_preclose_upper_bound_equals_decision_cutoff";
    availabilityAdapterId: typeof N2_EDGE_PROGRAM_AVAILABILITY_ADAPTER_ID;
    currentSnapshotFallbackAuthorized: false;
    racerProfilesReadAuthorized: false;
    racerCourseStatsReadAuthorized: false;
    exhibitionResidualReadAuthorized: false;
    databaseWriteAuthorized: false;
  };
  features: Record<string, N2EdgeFeatureObservation>;
  outputDigest: string;
};

function blocked(input: {
  blockers: string[];
  betSelection: string;
  featureMode: HistoricalProgramFeatureUsageMode;
}): N2EdgeHistoricalProgramAdapterResult {
  const core = {
    adapterVersion: N2_EDGE_HISTORICAL_PROGRAM_ADAPTER_VERSION,
    status: "BLOCKED" as const,
    blockers: [...new Set(input.blockers)].sort(),
    betSelection: input.betSelection,
    featureMode: input.featureMode,
    mappedFeatureCount: 0,
    nullFeatureCount: 0,
    selectedBoatCount: 0,
    sourceEvidence: {
      sourceClass: "official_program_plus_race_scoped_motor_boat" as const,
      availabilityPolicy: "conservative_preclose_upper_bound_equals_decision_cutoff" as const,
      availabilityAdapterId: N2_EDGE_PROGRAM_AVAILABILITY_ADAPTER_ID,
      currentSnapshotFallbackAuthorized: false as const,
      racerProfilesReadAuthorized: false as const,
      racerCourseStatsReadAuthorized: false as const,
      exhibitionResidualReadAuthorized: false as const,
      databaseWriteAuthorized: false as const,
    },
    features: {} as Record<string, N2EdgeFeatureObservation>,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

function validDecisionCutoff(value: string): boolean {
  try {
    canonicalUtcTimestamp(value);
    return true;
  } catch {
    return false;
  }
}

function observation(value: unknown, decisionCutoff: string): N2EdgeFeatureObservation {
  const normalized = typeof value === "string"
    ? (value.trim() ? value.trim() : null)
    : typeof value === "number" && Number.isFinite(value)
      ? value
      : null;
  return {
    value: normalized,
    pitClass: "historical_safe",
    // programFeatureSafety classifies these fields as race-time historical safe.
    // We intentionally use the decision cutoff as a conservative availability
    // upper bound rather than inventing a finer publication timestamp.
    availableAt: decisionCutoff,
    adapterId: N2_EDGE_PROGRAM_AVAILABILITY_ADAPTER_ID,
    adapterVerified: true,
  };
}

export function adaptN2HistoricalProgramFeatures(input: {
  betSelection: string;
  decisionCutoff: string;
  featureMode: HistoricalProgramFeatureUsageMode;
  programFeatures: ProgramFeatureSnapshot;
}): N2EdgeHistoricalProgramAdapterResult {
  const blockers: string[] = [];
  if (input.featureMode !== "historical-readonly") {
    blockers.push(`FEATURE_MODE_NOT_READONLY:${input.featureMode}`);
  }
  if (!TRIFECTA_SELECTIONS.has(input.betSelection)) {
    blockers.push(`INVALID_TRIFECTA_SELECTION:${input.betSelection}`);
  }
  if (!validDecisionCutoff(input.decisionCutoff)) {
    blockers.push("INVALID_DECISION_CUTOFF");
  }

  const safety = classifyProgramFeatureSafety(input.programFeatures, input.featureMode);
  if (!safety.isHistoricalSafe) {
    blockers.push(`LIVE_ONLY_FEATURE_PRESENT:${safety.liveOnlyNonNullCount}`);
  }
  if (blockers.length > 0) {
    return blocked({
      blockers,
      betSelection: input.betSelection,
      featureMode: input.featureMode,
    });
  }

  const courses = input.betSelection.split("-").map(Number);
  const selectedBoats = courses.map((course, index) => {
    const boat = input.programFeatures.boats.find((candidate) => candidate.course === course);
    if (!boat) blockers.push(`SELECTED_BOAT_MISSING:${ROLES[index]}:${course}`);
    return boat ?? null;
  });
  if (blockers.length > 0) {
    return blocked({
      blockers,
      betSelection: input.betSelection,
      featureMode: input.featureMode,
    });
  }

  const features: Record<string, N2EdgeFeatureObservation> = {};
  let nullFeatureCount = 0;
  for (let index = 0; index < ROLES.length; index += 1) {
    const role = ROLES[index];
    const boat = selectedBoats[index]!;
    for (const [suffix, field] of ROLE_FIELD_MAPPING) {
      const feature = observation(boat[field], input.decisionCutoff);
      features[`${role}${suffix}`] = feature;
      if (feature.value === null) nullFeatureCount += 1;
    }
  }

  const mappedBaseFields = ROLE_FIELD_MAPPING.map(([, field]) => field);
  const canonicalSafeFields = new Set<string>(HISTORICAL_SAFE_FEATURE_KEYS);
  for (const field of mappedBaseFields) {
    if (!canonicalSafeFields.has(field)) blockers.push(`MAPPED_FIELD_NOT_CANONICAL_SAFE:${String(field)}`);
  }
  if (blockers.length > 0) {
    return blocked({
      blockers,
      betSelection: input.betSelection,
      featureMode: input.featureMode,
    });
  }

  const core = {
    adapterVersion: N2_EDGE_HISTORICAL_PROGRAM_ADAPTER_VERSION,
    status: "PASS" as const,
    blockers: [] as string[],
    betSelection: input.betSelection,
    featureMode: input.featureMode,
    mappedFeatureCount: Object.keys(features).length,
    nullFeatureCount,
    selectedBoatCount: selectedBoats.length,
    sourceEvidence: {
      sourceClass: "official_program_plus_race_scoped_motor_boat" as const,
      availabilityPolicy: "conservative_preclose_upper_bound_equals_decision_cutoff" as const,
      availabilityAdapterId: N2_EDGE_PROGRAM_AVAILABILITY_ADAPTER_ID,
      currentSnapshotFallbackAuthorized: false as const,
      racerProfilesReadAuthorized: false as const,
      racerCourseStatsReadAuthorized: false as const,
      exhibitionResidualReadAuthorized: false as const,
      databaseWriteAuthorized: false as const,
    },
    features,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

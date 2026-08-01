import { createHash } from "node:crypto";

export const N2_FEATURE_COVERAGE_PROFILE_VERSION = "n2-feature-coverage-v1";

export type N2FeatureCoverageEvent = {
  canonicalRaceKey: string;
  sourceKind: "feature" | "odds";
  key: string;
  status: "verified" | "excluded";
  observationId?: string;
  rawDocumentId?: string;
  availabilityBasis?: "source_published_at" | "source_observed_at";
  exclusionReason?: string;
};

export type N2FeatureCoverageBucket = {
  key: string;
  expected: number;
  verified: number;
  excluded: number;
  coveragePct: number;
  provenanceComplete: number;
  uniqueObservationCount: number;
  uniqueRawDocumentCount: number;
  availabilityBasisCounts: Record<string, number>;
  exclusionReasons: Record<string, number>;
};

export type N2FeatureCoverageProfile = {
  profileVersion: string;
  dataStatus: "REAL_DATA" | "FIXTURE_ONLY" | "PENDING_REAL_DATA";
  totalEvents: number;
  totalRaces: number;
  overall: N2FeatureCoverageBucket;
  byYear: N2FeatureCoverageBucket[];
  byFeature: N2FeatureCoverageBucket[];
  digest: string;
};

type MutableBucket = {
  expected: number;
  verified: number;
  excluded: number;
  provenanceComplete: number;
  observations: Set<string>;
  rawDocuments: Set<string>;
  availabilityBasisCounts: Map<string, number>;
  exclusionReasons: Map<string, number>;
};

function emptyBucket(): MutableBucket {
  return {
    expected: 0, verified: 0, excluded: 0, provenanceComplete: 0,
    observations: new Set(), rawDocuments: new Set(),
    availabilityBasisCounts: new Map(), exclusionReasons: new Map(),
  };
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function record(bucket: MutableBucket, event: N2FeatureCoverageEvent): void {
  bucket.expected += 1;
  if (event.status === "verified") {
    bucket.verified += 1;
    bucket.provenanceComplete += 1;
    bucket.observations.add(event.observationId!);
    bucket.rawDocuments.add(event.rawDocumentId!);
    increment(bucket.availabilityBasisCounts, event.availabilityBasis!);
  } else {
    bucket.excluded += 1;
    increment(bucket.exclusionReasons, event.exclusionReason!);
  }
}

function stableRecord(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function freezeBucket(key: string, bucket: MutableBucket): N2FeatureCoverageBucket {
  return {
    key,
    expected: bucket.expected,
    verified: bucket.verified,
    excluded: bucket.excluded,
    coveragePct: bucket.expected === 0 ? 0 : Number((bucket.verified / bucket.expected * 100).toFixed(4)),
    provenanceComplete: bucket.provenanceComplete,
    uniqueObservationCount: bucket.observations.size,
    uniqueRawDocumentCount: bucket.rawDocuments.size,
    availabilityBasisCounts: stableRecord(bucket.availabilityBasisCounts),
    exclusionReasons: stableRecord(bucket.exclusionReasons),
  };
}

function raceYear(canonicalRaceKey: string): string {
  const match = /^(\d{4})-\d{2}-\d{2}:/.exec(canonicalRaceKey);
  if (!match) throw new Error(`N2_COVERAGE_INVALID_RACE_KEY:${canonicalRaceKey}`);
  return match[1];
}

export function buildN2FeatureCoverageProfile(input: {
  inputKind: "real" | "fixture";
  events: N2FeatureCoverageEvent[];
}): N2FeatureCoverageProfile {
  const sorted = [...input.events].sort((a, b) =>
    `${a.canonicalRaceKey}\u0000${a.sourceKind}\u0000${a.key}`.localeCompare(
      `${b.canonicalRaceKey}\u0000${b.sourceKind}\u0000${b.key}`,
    ));
  const seen = new Set<string>();
  const races = new Set<string>();
  const overall = emptyBucket();
  const years = new Map<string, MutableBucket>();
  const features = new Map<string, MutableBucket>();

  for (const event of sorted) {
    if (!event.key) throw new Error("N2_COVERAGE_EMPTY_KEY");
    const identity = `${event.canonicalRaceKey}\u0000${event.sourceKind}\u0000${event.key}`;
    if (seen.has(identity)) throw new Error(`N2_COVERAGE_DUPLICATE_EVENT:${identity}`);
    seen.add(identity);
    const year = raceYear(event.canonicalRaceKey);
    if (event.status === "verified") {
      if (!event.observationId || !event.rawDocumentId || !event.availabilityBasis || event.exclusionReason) {
        throw new Error(`N2_COVERAGE_INVALID_VERIFIED_EVENT:${identity}`);
      }
    } else if (!event.exclusionReason || event.observationId || event.rawDocumentId || event.availabilityBasis) {
      throw new Error(`N2_COVERAGE_INVALID_EXCLUDED_EVENT:${identity}`);
    }
    races.add(event.canonicalRaceKey);
    const featureKey = `${event.sourceKind}:${event.key}`;
    const yearBucket = years.get(year) ?? emptyBucket();
    const featureBucket = features.get(featureKey) ?? emptyBucket();
    years.set(year, yearBucket);
    features.set(featureKey, featureBucket);
    record(overall, event);
    record(yearBucket, event);
    record(featureBucket, event);
  }

  const profileWithoutDigest = {
    profileVersion: N2_FEATURE_COVERAGE_PROFILE_VERSION,
    dataStatus: input.events.length === 0 ? "PENDING_REAL_DATA" as const
      : input.inputKind === "fixture" ? "FIXTURE_ONLY" as const : "REAL_DATA" as const,
    totalEvents: sorted.length,
    totalRaces: races.size,
    overall: freezeBucket("all", overall),
    byYear: [...years.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => freezeBucket(key, value)),
    byFeature: [...features.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => freezeBucket(key, value)),
  };
  const digest = createHash("sha256").update(JSON.stringify(profileWithoutDigest)).digest("hex");
  return { ...profileWithoutDigest, digest };
}

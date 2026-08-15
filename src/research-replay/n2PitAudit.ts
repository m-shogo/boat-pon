import { canonicalHash } from "./canonical";
import {
  validateFeaturePIT,
  validateOddsUsage,
  type FeaturePITResult,
  type OddsUsageResult,
} from "./n2DatasetContract";
import {
  verifyN2FeatureLineage,
  type N2FeatureLineageEvidenceRow,
} from "./n2FeatureLineage";

export const N2_PIT_AUDIT_VERSION = "n2-pit-audit-v1";

export const N2_PIT_FEATURE_SOURCE_TYPES = ["official_program", "trifecta_market"] as const;
export type N2PitFeatureSourceType = (typeof N2_PIT_FEATURE_SOURCE_TYPES)[number];

export const N2_POST_RACE_SOURCE_TYPES = [
  "official_result",
  "race_result",
  "settlement",
  "payout",
  "refund",
  "decision_outcome",
] as const;

export type N2PitAuditObservation = N2FeatureLineageEvidenceRow & {
  decisionCutoff: string | null;
};

export type N2PitAuditReasonClass =
  | "safe"
  | "same_race_leakage"
  | "future_leakage"
  | "ambiguous_timing"
  | "lineage_exclusion"
  | "source_not_allowed";

export type N2PitAuditEventResult = {
  observationType: string;
  reasonClass: N2PitAuditReasonClass;
  reason: string;
  usable: boolean;
};

export type N2PitAuditSummary = {
  auditVersion: typeof N2_PIT_AUDIT_VERSION;
  status: "PASS" | "CONDITIONAL" | "FAILED";
  dataStatus: "REAL_DATA" | "PENDING_REAL_DATA";
  auditedObservationCount: number;
  verifiedSafeCount: number;
  excludedCount: number;
  checkedFeatureCount: number;
  checkedOddsCount: number;
  sameRaceViolationCount: number;
  futureViolationCount: number;
  ambiguousTimingCount: number;
  postRaceFeatureRead: boolean;
  allowedSourceTypes: readonly N2PitFeatureSourceType[];
  reasonClassCounts: Record<N2PitAuditReasonClass, number>;
  reasonCounts: Record<string, number>;
  inputDigest: string;
  outputDigest: string;
};

const ALLOWED_SOURCE_TYPES = new Set<string>(N2_PIT_FEATURE_SOURCE_TYPES);
const POST_RACE_SOURCE_TYPES = new Set<string>(N2_POST_RACE_SOURCE_TYPES);

function stableCounts(input: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...input.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function hasValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function validTimestamp(value: string | null): value is string {
  if (value === null || !hasValidCalendarDate(value)) return false;
  const clock = /T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?/.exec(value);
  if (clock === null) return false;
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  const second = Number(clock[3]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return false;
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(value);
  if (offset !== null && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function lineageReasonClass(reason: string): N2PitAuditReasonClass {
  if (
    reason.includes("unknown_timestamp") ||
    reason.includes("ambiguous_timing") ||
    reason.includes("timestamp_order")
  ) return "ambiguous_timing";
  return "lineage_exclusion";
}

function featureReasonClass(result: FeaturePITResult): N2PitAuditReasonClass {
  if (result.usable) return "safe";
  if (result.reason === "excluded_pit_after_cutoff") return "future_leakage";
  if (result.reason === "excluded_pit_unknown_availability") return "ambiguous_timing";
  return "source_not_allowed";
}

function oddsReasonClass(result: OddsUsageResult): N2PitAuditReasonClass {
  if (result.usable) return "safe";
  if (
    result.reason === "excluded_odds_capture_after_cutoff" ||
    result.reason === "excluded_odds_available_after_cutoff" ||
    result.reason === "excluded_odds_available_after_capture"
  ) return "future_leakage";
  if (result.reason === "excluded_odds_unknown_timestamp") return "ambiguous_timing";
  return "source_not_allowed";
}

export function auditN2PitObservation(observation: N2PitAuditObservation): N2PitAuditEventResult {
  if (POST_RACE_SOURCE_TYPES.has(observation.observationType)) {
    return {
      observationType: observation.observationType,
      reasonClass: "same_race_leakage",
      reason: "same_race_post_race_source_used_as_feature",
      usable: false,
    };
  }
  if (!ALLOWED_SOURCE_TYPES.has(observation.observationType)) {
    return {
      observationType: observation.observationType,
      reasonClass: "source_not_allowed",
      reason: "feature_source_type_not_allowlisted",
      usable: false,
    };
  }
  if (!validTimestamp(observation.decisionCutoff)) {
    return {
      observationType: observation.observationType,
      reasonClass: "ambiguous_timing",
      reason: "decision_cutoff_missing_or_invalid",
      usable: false,
    };
  }

  const lineage = verifyN2FeatureLineage({
    canonicalRaceKey: observation.canonicalRaceKey,
    observationId: observation.observationId,
    rawDocumentId: observation.rawDocumentId,
    allowedObservationTypes: [observation.observationType],
  }, observation);
  if (lineage.status === "excluded") {
    return {
      observationType: observation.observationType,
      reasonClass: lineageReasonClass(lineage.reason),
      reason: lineage.reason,
      usable: false,
    };
  }

  if (observation.observationType === "official_program") {
    const result = validateFeaturePIT({
      featureKey: "official_program",
      pitClass: "historical_safe",
      availableAt: lineage.lineage.sourceAvailableAt,
    }, observation.decisionCutoff, "historical");
    return {
      observationType: observation.observationType,
      reasonClass: featureReasonClass(result),
      reason: result.reason,
      usable: result.usable,
    };
  }

  const result = validateOddsUsage({
    kind: "live_checkpoint",
    role: "feature",
    capturedAt: lineage.lineage.sourceObservedAt,
    availableAt: lineage.lineage.sourceAvailableAt,
    decisionCutoff: observation.decisionCutoff,
  });
  return {
    observationType: observation.observationType,
    reasonClass: oddsReasonClass(result),
    reason: result.reason,
    usable: result.usable,
  };
}

function auditInputDigest(observations: N2PitAuditObservation[]): string {
  return canonicalHash(observations.map((observation) => ({
    observationId: observation.observationId,
    canonicalRaceKey: observation.canonicalRaceKey,
    observationType: observation.observationType,
    rawDocumentId: observation.rawDocumentId,
    sourcePublishedAt: observation.sourcePublishedAt,
    sourceObservedAt: observation.sourceObservedAt,
    firstSeenAt: observation.firstSeenAt,
    timingQuality: observation.timingQuality,
    sourceQuality: observation.sourceQuality,
    parseRawDocumentId: observation.parseRawDocumentId,
    parseStatus: observation.parseStatus,
    integrityStatus: observation.integrityStatus,
    securityScanStatus: observation.securityScanStatus,
    parserReplayEligible: observation.parserReplayEligible,
    decisionCutoff: observation.decisionCutoff,
  })).sort((a, b) => `${a.canonicalRaceKey}\u0000${a.observationId}`.localeCompare(
    `${b.canonicalRaceKey}\u0000${b.observationId}`,
  )));
}

export function buildN2PitAuditSummary(observations: N2PitAuditObservation[]): N2PitAuditSummary {
  const results = observations.map(auditN2PitObservation);
  const reasonClasses = new Map<string, number>();
  const reasons = new Map<string, number>();
  let verifiedSafeCount = 0;
  let checkedFeatureCount = 0;
  let checkedOddsCount = 0;
  let sameRaceViolationCount = 0;
  let futureViolationCount = 0;
  let ambiguousTimingCount = 0;

  for (const result of results) {
    increment(reasonClasses, result.reasonClass);
    increment(reasons, result.reason);
    if (result.observationType === "official_program") checkedFeatureCount += 1;
    if (result.observationType === "trifecta_market") checkedOddsCount += 1;
    if (result.usable) verifiedSafeCount += 1;
    if (result.reasonClass === "same_race_leakage") sameRaceViolationCount += 1;
    if (result.reasonClass === "future_leakage") futureViolationCount += 1;
    if (result.reasonClass === "ambiguous_timing") ambiguousTimingCount += 1;
  }

  const excludedCount = results.length - verifiedSafeCount;
  const status: N2PitAuditSummary["status"] = sameRaceViolationCount > 0 || futureViolationCount > 0
    ? "FAILED"
    : observations.length === 0 || excludedCount > 0
      ? "CONDITIONAL"
      : "PASS";
  const reasonClassCounts: Record<N2PitAuditReasonClass, number> = {
    safe: reasonClasses.get("safe") ?? 0,
    same_race_leakage: reasonClasses.get("same_race_leakage") ?? 0,
    future_leakage: reasonClasses.get("future_leakage") ?? 0,
    ambiguous_timing: reasonClasses.get("ambiguous_timing") ?? 0,
    lineage_exclusion: reasonClasses.get("lineage_exclusion") ?? 0,
    source_not_allowed: reasonClasses.get("source_not_allowed") ?? 0,
  };
  const withoutOutputDigest: Omit<N2PitAuditSummary, "outputDigest"> = {
    auditVersion: N2_PIT_AUDIT_VERSION,
    status,
    dataStatus: observations.length === 0 ? "PENDING_REAL_DATA" : "REAL_DATA",
    auditedObservationCount: observations.length,
    verifiedSafeCount,
    excludedCount,
    checkedFeatureCount,
    checkedOddsCount,
    sameRaceViolationCount,
    futureViolationCount,
    ambiguousTimingCount,
    postRaceFeatureRead: sameRaceViolationCount > 0,
    allowedSourceTypes: N2_PIT_FEATURE_SOURCE_TYPES,
    reasonClassCounts,
    reasonCounts: stableCounts(reasons),
    inputDigest: auditInputDigest(observations),
  };
  return {
    ...withoutOutputDigest,
    outputDigest: canonicalHash(withoutOutputDigest),
  };
}

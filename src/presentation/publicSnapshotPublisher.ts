import type { PublicDashboardSnapshot } from "./publicSnapshot";
import {
  DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS,
  verifyPublicDashboardSnapshotIntegrity,
} from "./publicSnapshotTransport";

export type PublicSnapshotPublicationResult = {
  ok: boolean;
  snapshot: PublicDashboardSnapshot | null;
  errors: string[];
  warnings: string[];
};

export async function validatePublicSnapshotForPublication(options: {
  candidate: unknown;
  existingLatest?: unknown;
  existingLastKnownGood?: unknown;
  nowMs?: number;
  maxFutureSkewMs?: number;
}): Promise<PublicSnapshotPublicationResult> {
  const nowMs = options.nowMs ?? Date.now();
  const maxFutureSkewMs = options.maxFutureSkewMs ?? DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS;
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxFutureSkewMs) || maxFutureSkewMs < 0) {
    return blocked("INVALID_PUBLICATION_CLOCK_CONFIGURATION");
  }

  const candidate = await verifyPublicDashboardSnapshotIntegrity(options.candidate);
  if (!candidate.ok || !candidate.snapshot) {
    return blocked("CANDIDATE_INVALID_OR_UNVERIFIED");
  }

  const candidateGeneratedAt = Date.parse(candidate.snapshot.generatedAt);
  const candidateDataAsOf = Date.parse(candidate.snapshot.dataAsOf);
  if (candidateGeneratedAt - nowMs > maxFutureSkewMs) return blocked("CANDIDATE_GENERATED_AT_IN_FUTURE");
  if (candidateDataAsOf - nowMs > maxFutureSkewMs) return blocked("CANDIDATE_DATA_AS_OF_IN_FUTURE");
  if (candidateDataAsOf > candidateGeneratedAt + maxFutureSkewMs) {
    return blocked("CANDIDATE_DATA_AFTER_GENERATION");
  }

  const warnings: string[] = [];
  for (const [label, existingValue] of [
    ["LATEST", options.existingLatest],
    ["LAST_KNOWN_GOOD", options.existingLastKnownGood],
  ] as const) {
    if (existingValue === undefined) continue;

    const existing = await verifyPublicDashboardSnapshotIntegrity(existingValue);
    if (!existing.ok || !existing.snapshot) {
      warnings.push(`EXISTING_${label}_INVALID_REPLACED`);
      continue;
    }

    const existingGeneratedAt = Date.parse(existing.snapshot.generatedAt);
    const existingDataAsOf = Date.parse(existing.snapshot.dataAsOf);
    const existingTimestampInvalid = existingGeneratedAt - nowMs > maxFutureSkewMs
      || existingDataAsOf - nowMs > maxFutureSkewMs
      || existingDataAsOf > existingGeneratedAt + maxFutureSkewMs;
    if (existingTimestampInvalid) {
      warnings.push(`EXISTING_${label}_INVALID_REPLACED`);
      continue;
    }

    if (candidateDataAsOf < existingDataAsOf) return blocked(`CANDIDATE_ROLLBACK_${label}_DATA_AS_OF`);
    if (candidateDataAsOf === existingDataAsOf && candidateGeneratedAt < existingGeneratedAt) {
      return blocked(`CANDIDATE_ROLLBACK_${label}_GENERATED_AT`);
    }
    if (
      candidateDataAsOf === existingDataAsOf
      && candidate.snapshot.integrity.digest === existing.snapshot.integrity.digest
    ) {
      warnings.push(`CANDIDATE_IDENTICAL_TO_${label}`);
    }
  }

  return {
    ok: true,
    snapshot: candidate.snapshot,
    errors: [],
    warnings,
  };
}

function blocked(error: string): PublicSnapshotPublicationResult {
  return {
    ok: false,
    snapshot: null,
    errors: [error],
    warnings: [],
  };
}

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
  if (options.existingLastKnownGood !== undefined) {
    const existing = await verifyPublicDashboardSnapshotIntegrity(options.existingLastKnownGood);
    if (existing.ok && existing.snapshot) {
      const existingGeneratedAt = Date.parse(existing.snapshot.generatedAt);
      const existingDataAsOf = Date.parse(existing.snapshot.dataAsOf);
      if (candidateDataAsOf < existingDataAsOf) return blocked("CANDIDATE_ROLLBACK_DATA_AS_OF");
      if (candidateDataAsOf === existingDataAsOf && candidateGeneratedAt < existingGeneratedAt) {
        return blocked("CANDIDATE_ROLLBACK_GENERATED_AT");
      }
      if (
        candidateDataAsOf === existingDataAsOf
        && candidate.snapshot.integrity.digest === existing.snapshot.integrity.digest
      ) {
        warnings.push("CANDIDATE_IDENTICAL_TO_LAST_KNOWN_GOOD");
      }
    } else {
      warnings.push("EXISTING_LAST_KNOWN_GOOD_INVALID_REPLACED");
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

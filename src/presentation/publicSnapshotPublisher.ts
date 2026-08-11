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
  for (const [source, existingValue] of [
    ["latest", options.existingLatest],
    ["last-known-good", options.existingLastKnownGood],
  ] as const) {
    if (existingValue === undefined) continue;

    const existing = await verifyPublicDashboardSnapshotIntegrity(existingValue);
    if (!existing.ok || !existing.snapshot) {
      warnings.push(existingInvalidWarning(source));
      continue;
    }

    const existingGeneratedAt = Date.parse(existing.snapshot.generatedAt);
    const existingDataAsOf = Date.parse(existing.snapshot.dataAsOf);
    const existingTimestampInvalid = existingGeneratedAt - nowMs > maxFutureSkewMs
      || existingDataAsOf - nowMs > maxFutureSkewMs
      || existingDataAsOf > existingGeneratedAt + maxFutureSkewMs;
    if (existingTimestampInvalid) {
      warnings.push(existingInvalidWarning(source));
      continue;
    }

    if (candidateDataAsOf < existingDataAsOf) return blocked(rollbackDataAsOfError(source));
    if (candidateDataAsOf === existingDataAsOf && candidateGeneratedAt < existingGeneratedAt) {
      return blocked(rollbackGeneratedAtError(source));
    }
    if (
      candidateDataAsOf === existingDataAsOf
      && candidate.snapshot.integrity.digest === existing.snapshot.integrity.digest
    ) {
      warnings.push(identicalWarning(source));
    }
  }

  return {
    ok: true,
    snapshot: candidate.snapshot,
    errors: [],
    warnings,
  };
}

function existingInvalidWarning(source: "latest" | "last-known-good"): string {
  return source === "latest"
    ? "EXISTING_LATEST_INVALID_REPLACED"
    : "EXISTING_LAST_KNOWN_GOOD_INVALID_REPLACED";
}

function rollbackDataAsOfError(source: "latest" | "last-known-good"): string {
  return source === "latest" ? "CANDIDATE_ROLLBACK_LATEST_DATA_AS_OF" : "CANDIDATE_ROLLBACK_DATA_AS_OF";
}

function rollbackGeneratedAtError(source: "latest" | "last-known-good"): string {
  return source === "latest" ? "CANDIDATE_ROLLBACK_LATEST_GENERATED_AT" : "CANDIDATE_ROLLBACK_GENERATED_AT";
}

function identicalWarning(source: "latest" | "last-known-good"): string {
  return source === "latest" ? "CANDIDATE_IDENTICAL_TO_LATEST" : "CANDIDATE_IDENTICAL_TO_LAST_KNOWN_GOOD";
}

function blocked(error: string): PublicSnapshotPublicationResult {
  return {
    ok: false,
    snapshot: null,
    errors: [error],
    warnings: [],
  };
}

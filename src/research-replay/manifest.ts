import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { CANONICALIZATION_VERSION, canonicalHash, canonicalUtcTimestamp } from "./canonical";
import {
  observationCategory,
  PAYLOAD_SCHEMA_VERSION,
  TIMEZONE_POLICY_VERSION,
  type ObservationType,
  type TrifectaMarketPayload,
} from "./domain";
import { parseCanonicalRaceKey } from "./identity";
import { ResearchReplayRepository } from "./repository";
import { SIDECAR_SCHEMA_VERSION } from "./schema";

export const MANIFEST_VERSION = "race-asof-manifest-v1";
export const FEATURE_VERSION = "none-f0";
export const TAXONOMY_VERSION = "pit-taxonomy-v1";

export type PitRejectionCode =
  | "OBSERVATION_AFTER_AS_OF"
  | "SOURCE_PUBLISHED_AFTER_AS_OF"
  | "FIRST_SEEN_AFTER_AS_OF"
  | "POST_RACE_OBSERVATION"
  | "RESULT_ONLY_SOURCE"
  | "TIMESTAMP_UNKNOWN"
  | "TIMING_AMBIGUOUS"
  | "SOURCE_QUALITY_NOT_ALLOWED"
  | "HISTORICAL_CLOSING_USED_AS_LIVE"
  | "CURRENT_PROFILE_USED_FOR_PAST_RACE"
  | "FIXTURE_USED_AS_LIVE"
  | "UNKNOWN_OBSERVATION_TYPE"
  | "PARSER_VERSION_UNKNOWN"
  | "PAYLOAD_SCHEMA_UNKNOWN"
  | "PAYLOAD_REFERENCE_MISSING"
  | "CANONICAL_RACE_MISMATCH"
  | "SCHEDULE_VERSION_MISSING"
  | "REQUIRED_INPUT_MISSING"
  | "STALE_REQUIRED_INPUT";

export type PitDisposition = "accepted" | "rejected" | "quarantined" | "manifest_generation_blocked";

export type ResolutionPolicy = {
  policyVersion: string;
  purpose: "research_replay_strict_pre_race" | "live_t5_strict_canary";
  requiredObservationTypes: ObservationType[];
  optionalObservationTypes: ObservationType[];
  sourcePriority: Array<"official_public" | "derived_existing_row" | "sanitized_fixture">;
  maxStalenessSeconds: number;
  timestampUnknownPolicy: "reject";
  tieBreakPolicy: "source_priority_observed_desc_id_asc";
  fallbackPolicy: "none";
  forbiddenObservationTypes: ObservationType[];
};

export const RESOLUTION_POLICIES: Record<ResolutionPolicy["purpose"], ResolutionPolicy> = {
  research_replay_strict_pre_race: {
    policyVersion: "rr-strict-pre-race-v1",
    purpose: "research_replay_strict_pre_race",
    requiredObservationTypes: ["race_schedule", "trifecta_market", "beforeinfo"],
    optionalObservationTypes: [],
    sourcePriority: ["official_public", "derived_existing_row", "sanitized_fixture"],
    maxStalenessSeconds: 24 * 60 * 60,
    timestampUnknownPolicy: "reject",
    tieBreakPolicy: "source_priority_observed_desc_id_asc",
    fallbackPolicy: "none",
    forbiddenObservationTypes: ["race_result", "current_racer_profile", "historical_closing_odds", "fixture_only"],
  },
  live_t5_strict_canary: {
    policyVersion: "live-t5-strict-canary-v1",
    purpose: "live_t5_strict_canary",
    requiredObservationTypes: ["race_schedule", "trifecta_market", "beforeinfo"],
    optionalObservationTypes: [],
    sourcePriority: ["official_public"],
    maxStalenessSeconds: 45 * 60,
    timestampUnknownPolicy: "reject",
    tieBreakPolicy: "source_priority_observed_desc_id_asc",
    fallbackPolicy: "none",
    forbiddenObservationTypes: ["race_result", "current_racer_profile", "historical_closing_odds", "fixture_only"],
  },
};

type ObservationRow = {
  observation_id: string;
  canonical_race_key: string;
  observation_type: string;
  payload_schema_version: string;
  parse_run_id: string;
  raw_document_id: string;
  source_published_at: string | null;
  source_observed_at: string;
  first_seen_at: string;
  timing_quality: "source_exact" | "observed_only" | "ambiguous" | "unknown";
  source_quality: "official_public" | "derived_existing_row" | "sanitized_fixture";
  semantic_payload_hash: string;
  parser_version: string;
  parse_status: string;
};

export type PitGuardResult = {
  observationId: string;
  observationType: string;
  disposition: PitDisposition;
  codes: PitRejectionCode[];
  qualityFlags: string[];
};

export type ManifestExpectationResult = {
  expectedObservationType: ObservationType;
  requirement: "required" | "optional";
  completenessState:
    | "found"
    | "missing"
    | "stale"
    | "rejected"
    | "not_published"
    | "not_observed"
    | "not_offered"
    | "parse_error"
    | "timing_ambiguous"
    | "point_in_time_ineligible";
  selectedObservationId: string | null;
  rejectionCode: PitRejectionCode | null;
  missingReason: string | null;
};

export type ManifestBuildResult = {
  manifestId: string;
  canonicalRaceKey: string;
  asOfAt: string;
  purpose: ResolutionPolicy["purpose"];
  resolverPolicyVersion: string;
  status: "complete" | "incomplete" | "blocked";
  manifestHash: string;
  inputHash: string;
  selectedObservationIds: string[];
  expectations: ManifestExpectationResult[];
  rejectedObservations: PitGuardResult[];
  maxSourcePublishedAt: string | null;
  maxSourceObservedAt: string;
  qualityFlags: string[];
  persisted: boolean;
};

function laterThan(left: string, right: string): boolean {
  return new Date(left).getTime() > new Date(right).getTime();
}

function contentHash(policy: ResolutionPolicy): string {
  return canonicalHash(policy);
}

export function registerResolutionPolicies(db: DatabaseSync, createdAt: string): void {
  const statement = db.prepare(`
    INSERT OR IGNORE INTO asof_resolution_policies
    (policy_version, purpose, required_observation_types, optional_observation_types,
     source_priority, max_staleness_seconds, timestamp_unknown_policy, tie_break_policy,
     fallback_policy, forbidden_observation_types, content_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const policy of Object.values(RESOLUTION_POLICIES)) {
    statement.run(
      policy.policyVersion,
      policy.purpose,
      JSON.stringify(policy.requiredObservationTypes),
      JSON.stringify(policy.optionalObservationTypes),
      JSON.stringify(policy.sourcePriority),
      policy.maxStalenessSeconds,
      policy.timestampUnknownPolicy,
      policy.tieBreakPolicy,
      policy.fallbackPolicy,
      JSON.stringify(policy.forbiddenObservationTypes),
      contentHash(policy),
      createdAt,
    );
  }
}

export function strictPitGuard(input: {
  observation: ObservationRow;
  repository: ResearchReplayRepository;
  canonicalRaceKey: string;
  asOfAt: string;
  policy: ResolutionPolicy;
}): PitGuardResult {
  const { observation, repository, canonicalRaceKey, policy } = input;
  const asOfAt = canonicalUtcTimestamp(input.asOfAt);
  const codes: PitRejectionCode[] = [];
  const qualityFlags: string[] = [];
  const category = observationCategory(observation.observation_type);
  if (!category) codes.push("UNKNOWN_OBSERVATION_TYPE");
  if (observation.canonical_race_key !== canonicalRaceKey) codes.push("CANONICAL_RACE_MISMATCH");
  if (laterThan(observation.source_observed_at, asOfAt)) codes.push("OBSERVATION_AFTER_AS_OF");
  if (observation.source_published_at && laterThan(observation.source_published_at, asOfAt)) {
    codes.push("SOURCE_PUBLISHED_AFTER_AS_OF");
  }
  if (laterThan(observation.first_seen_at, asOfAt)) codes.push("FIRST_SEEN_AFTER_AS_OF");
  if (observation.timing_quality === "unknown") codes.push("TIMESTAMP_UNKNOWN");
  if (observation.timing_quality === "ambiguous") codes.push("TIMING_AMBIGUOUS");
  if (!policy.sourcePriority.includes(observation.source_quality)) codes.push("SOURCE_QUALITY_NOT_ALLOWED");
  if (policy.purpose === "live_t5_strict_canary" && observation.source_quality === "sanitized_fixture") {
    codes.push("FIXTURE_USED_AS_LIVE");
  }
  if (!observation.parser_version.startsWith("rr-parser-")) codes.push("PARSER_VERSION_UNKNOWN");
  if (observation.payload_schema_version !== PAYLOAD_SCHEMA_VERSION) codes.push("PAYLOAD_SCHEMA_UNKNOWN");
  if (category === "post_race") codes.push("POST_RACE_OBSERVATION", "RESULT_ONLY_SOURCE");
  if (category === "current_only") codes.push("CURRENT_PROFILE_USED_FOR_PAST_RACE");
  if (category === "historical_closing" && policy.purpose === "live_t5_strict_canary") {
    codes.push("HISTORICAL_CLOSING_USED_AS_LIVE");
  }
  if (category === "fixture_only" && policy.purpose === "live_t5_strict_canary") {
    codes.push("FIXTURE_USED_AS_LIVE");
  }
  if (policy.forbiddenObservationTypes.includes(observation.observation_type as ObservationType)) {
    if (category === "post_race" && !codes.includes("POST_RACE_OBSERVATION")) codes.push("POST_RACE_OBSERVATION");
  }
  try {
    const typed = repository.loadTypedPayload(observation.observation_id);
    if (typed.type === "trifecta_market" || typed.type === "historical_closing_odds") {
      const market = typed.payload as TrifectaMarketPayload;
      if (!market.scheduledCloseObservationId) codes.push("SCHEDULE_VERSION_MISSING");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    codes.push(message.includes("SCHEMA") ? "PAYLOAD_SCHEMA_UNKNOWN" : "PAYLOAD_REFERENCE_MISSING");
  }
  if (observation.timing_quality === "observed_only") qualityFlags.push("SOURCE_PUBLISHED_AT_UNAVAILABLE");
  const uniqueCodes = [...new Set(codes)];
  const disposition: PitDisposition = uniqueCodes.includes("TIMING_AMBIGUOUS")
    ? "quarantined"
    : uniqueCodes.length > 0
      ? "rejected"
      : "accepted";
  return {
    observationId: observation.observation_id,
    observationType: observation.observation_type,
    disposition,
    codes: uniqueCodes,
    qualityFlags,
  };
}

function selectCandidate(
  rows: ObservationRow[],
  guards: Map<string, PitGuardResult>,
  policy: ResolutionPolicy,
): ObservationRow | null {
  return rows
    .filter((row) => guards.get(row.observation_id)?.disposition === "accepted")
    .sort((left, right) => {
      const source = policy.sourcePriority.indexOf(left.source_quality) - policy.sourcePriority.indexOf(right.source_quality);
      if (source !== 0) return source;
      const observed = right.source_observed_at.localeCompare(left.source_observed_at);
      if (observed !== 0) return observed;
      return left.observation_id.localeCompare(right.observation_id);
    })[0] ?? null;
}

export function buildRaceAsOfManifest(input: {
  db: DatabaseSync;
  repository: ResearchReplayRepository;
  canonicalRaceKey: string;
  asOfAt: string;
  purpose: ResolutionPolicy["purpose"];
  gitCommitSha: string;
  sourceSnapshotId: string;
  persist?: boolean;
  idFactory?: () => string;
  createdAt?: string;
}): ManifestBuildResult {
  parseCanonicalRaceKey(input.canonicalRaceKey);
  const asOfAt = canonicalUtcTimestamp(input.asOfAt);
  const policy = RESOLUTION_POLICIES[input.purpose];
  const createdAt = canonicalUtcTimestamp(input.createdAt ?? new Date().toISOString());
  const idFactory = input.idFactory ?? randomUUID;
  registerResolutionPolicies(input.db, createdAt);
  const rows = input.db.prepare(`
    SELECT o.*, p.parser_version, p.status AS parse_status
    FROM domain_observations o
    JOIN parse_runs p ON p.parse_run_id = o.parse_run_id
    WHERE o.canonical_race_key = ?
    ORDER BY o.observation_id
  `).all(input.canonicalRaceKey) as ObservationRow[];
  const guards = new Map(rows.map((row) => [
    row.observation_id,
    strictPitGuard({
      observation: row,
      repository: input.repository,
      canonicalRaceKey: input.canonicalRaceKey,
      asOfAt,
      policy,
    }),
  ]));

  const expectations: ManifestExpectationResult[] = [];
  const selectedRows: ObservationRow[] = [];
  for (const type of [...policy.requiredObservationTypes, ...policy.optionalObservationTypes]) {
    const requirement = policy.requiredObservationTypes.includes(type) ? "required" : "optional";
    const candidates = rows.filter((row) => row.observation_type === type);
    const selected = selectCandidate(candidates, guards, policy);
    if (selected) {
      const ageSeconds = (new Date(asOfAt).getTime() - new Date(selected.source_observed_at).getTime()) / 1000;
      if (ageSeconds > policy.maxStalenessSeconds) {
        expectations.push({
          expectedObservationType: type,
          requirement,
          completenessState: "stale",
          selectedObservationId: null,
          rejectionCode: "STALE_REQUIRED_INPUT",
          missingReason: `age_seconds=${ageSeconds}`,
        });
      } else {
        selectedRows.push(selected);
        expectations.push({
          expectedObservationType: type,
          requirement,
          completenessState: "found",
          selectedObservationId: selected.observation_id,
          rejectionCode: null,
          missingReason: null,
        });
      }
      continue;
    }
    const rejected = candidates.flatMap((row) => guards.get(row.observation_id)?.codes ?? []);
    const timingAmbiguous = rejected.includes("TIMING_AMBIGUOUS");
    expectations.push({
      expectedObservationType: type,
      requirement,
      completenessState: timingAmbiguous
        ? "timing_ambiguous"
        : candidates.length > 0
          ? "point_in_time_ineligible"
          : "missing",
      selectedObservationId: null,
      rejectionCode: rejected[0] ?? (requirement === "required" ? "REQUIRED_INPUT_MISSING" : null),
      missingReason: candidates.length === 0 ? "no observation in searched evidence" : "all candidates rejected",
    });
  }

  selectedRows.sort((left, right) =>
    policy.requiredObservationTypes.indexOf(left.observation_type as ObservationType)
    - policy.requiredObservationTypes.indexOf(right.observation_type as ObservationType)
    || left.observation_id.localeCompare(right.observation_id)
  );
  const requiredFailures = expectations.filter((item) =>
    item.requirement === "required" && item.completenessState !== "found"
  );
  const status: ManifestBuildResult["status"] = requiredFailures.length === 0 ? "complete" : "blocked";
  const parserVersionSet = [...new Set(selectedRows.map((row) => row.parser_version))].sort();
  const inputRoot = {
    canonicalRaceKey: input.canonicalRaceKey,
    asOfAt,
    purpose: input.purpose,
    resolverPolicyVersion: policy.policyVersion,
    selected: selectedRows.map((row) => ({
      observationId: row.observation_id,
      observationType: row.observation_type,
      semanticPayloadHash: row.semantic_payload_hash,
      rawDocumentId: row.raw_document_id,
      parseRunId: row.parse_run_id,
    })),
    expectations,
  };
  const inputHash = canonicalHash(inputRoot);
  const manifestRoot = {
    ...inputRoot,
    gitCommitSha: input.gitCommitSha,
    sidecarSchemaVersion: SIDECAR_SCHEMA_VERSION,
    manifestVersion: MANIFEST_VERSION,
    parserVersionSet,
    featureVersion: FEATURE_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    sourceSnapshotId: input.sourceSnapshotId,
    timezonePolicyVersion: TIMEZONE_POLICY_VERSION,
    inputHash,
  };
  const manifestHash = canonicalHash(manifestRoot);
  const sourcePublished = selectedRows.map((row) => row.source_published_at).filter((value): value is string => Boolean(value)).sort();
  const sourceObserved = selectedRows.map((row) => row.source_observed_at).sort();
  const maxSourcePublishedAt = sourcePublished.at(-1) ?? null;
  const maxSourceObservedAt = sourceObserved.at(-1) ?? asOfAt;
  const qualityFlags = selectedRows.flatMap((row) => guards.get(row.observation_id)?.qualityFlags ?? []);
  const rejectedObservations = rows
    .map((row) => guards.get(row.observation_id)!)
    .filter((guard) => guard.disposition !== "accepted");
  let manifestId = `dry-${manifestHash.slice(0, 24)}`;
  let persisted = false;

  if (input.persist !== false) {
    const existing = input.db.prepare(`
      SELECT manifest_id FROM race_asof_manifests WHERE manifest_hash=?
    `).get(manifestHash) as { manifest_id: string } | undefined;
    if (existing) {
      manifestId = existing.manifest_id;
      persisted = true;
    } else {
      manifestId = idFactory();
      input.db.exec("BEGIN IMMEDIATE");
      try {
        input.db.prepare(`
          INSERT INTO race_asof_manifests
          (manifest_id, canonical_race_key, as_of_at, purpose, strict_mode, manifest_version,
           resolver_policy_version, canonicalization_version, schema_version, git_commit_sha,
           timezone_policy_version, feature_version, taxonomy_version, source_snapshot_id,
           input_hash, manifest_hash, max_source_published_at, max_source_observed_at, status, created_at)
          VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          manifestId,
          input.canonicalRaceKey,
          asOfAt,
          input.purpose,
          MANIFEST_VERSION,
          policy.policyVersion,
          CANONICALIZATION_VERSION,
          SIDECAR_SCHEMA_VERSION,
          input.gitCommitSha,
          TIMEZONE_POLICY_VERSION,
          FEATURE_VERSION,
          TAXONOMY_VERSION,
          input.sourceSnapshotId,
          inputHash,
          manifestHash,
          maxSourcePublishedAt,
          maxSourceObservedAt,
          status,
          createdAt,
        );
        for (const expectation of expectations) {
          input.db.prepare(`
            INSERT INTO race_asof_manifest_expectations
            (expectation_id, manifest_id, expected_observation_type, requirement,
             completeness_state, selected_observation_id, searched_sources, searched_from,
             searched_to, rejection_code, missing_reason, detail_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            idFactory(),
            manifestId,
            expectation.expectedObservationType,
            expectation.requirement,
            expectation.completenessState,
            expectation.selectedObservationId,
            JSON.stringify(policy.sourcePriority),
            "1970-01-01T00:00:00.000Z",
            asOfAt,
            expectation.rejectionCode,
            expectation.missingReason,
            JSON.stringify({ policyVersion: policy.policyVersion }),
            createdAt,
          );
        }
        selectedRows.forEach((row, ordinal) => {
          input.db.prepare(`
            INSERT INTO race_asof_manifest_items
            (manifest_item_id, manifest_id, observation_id, role, ordinal,
             inclusion_reason, quality_flags, created_at)
            VALUES (?, ?, ?, 'resolver_input', ?, 'selected_by_versioned_policy', ?, ?)
          `).run(
            idFactory(),
            manifestId,
            row.observation_id,
            ordinal,
            JSON.stringify(guards.get(row.observation_id)?.qualityFlags ?? []),
            createdAt,
          );
          for (const [evidenceType, evidenceId] of [
            ["raw_document", row.raw_document_id],
            ["parse_run", row.parse_run_id],
            ["domain_observation", row.observation_id],
          ] as const) {
            input.db.prepare(`
              INSERT INTO evidence_pins
              (pin_id, manifest_id, evidence_type, evidence_id, pin_reason, created_at)
              VALUES (?, ?, ?, ?, 'manifest_reference', ?)
            `).run(idFactory(), manifestId, evidenceType, evidenceId, createdAt);
          }
        });
        input.db.exec("COMMIT");
        persisted = true;
      } catch (error) {
        input.db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  return {
    manifestId,
    canonicalRaceKey: input.canonicalRaceKey,
    asOfAt,
    purpose: input.purpose,
    resolverPolicyVersion: policy.policyVersion,
    status,
    manifestHash,
    inputHash,
    selectedObservationIds: selectedRows.map((row) => row.observation_id),
    expectations,
    rejectedObservations,
    maxSourcePublishedAt,
    maxSourceObservedAt,
    qualityFlags: [...new Set(qualityFlags)].sort(),
    persisted,
  };
}

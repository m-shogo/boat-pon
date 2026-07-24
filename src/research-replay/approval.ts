import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import {
  APPROVAL_CONTRACT_VERSION,
  ROLLOUT_SCHEMA_VERSION,
  verifyRolloutSchema,
} from "./schema";

export const F0R_APPROVAL_SCOPE = "F0-R_START_AND_SIDECAR_ROLLOUT";
export const F0R_APPROVAL_RESOLVER_VERSION = "f0r-approval-resolver-v1";

export type ApprovalMode = "production" | "simulated";

export type ApprovalGrantInput = {
  approvalId: string;
  approvalScope: string;
  approvalSource: string;
  approvalReference: string;
  targetStage: string;
  targetSchemaVersion: string;
  targetContractVersion: string;
  approvedAt: string;
  approvalMode: ApprovalMode;
};

export type ApprovalLifecycleInput = {
  lifecycleEventId: string;
  eventKind: "revoked" | "superseded" | "legacy_disqualified";
  subjectApprovalId: string;
  replacementApprovalId: string | null;
  reason: string;
  source: string;
  reference: string;
  occurredAt: string;
};

type ApprovalGrantRow = {
  approval_id: string;
  approval_scope: string;
  approval_source: string;
  approval_reference: string;
  target_stage: string;
  target_schema_version: string;
  target_contract_version: string;
  approved_at: string;
  approval_mode: ApprovalMode;
  content_hash: string;
  recorded_at: string;
};

function required(name: string, value: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`approval field required: ${name}`);
  }
  return value.trim();
}

function instant(name: string, value: string): string {
  const normalized = canonicalUtcTimestamp(required(name, value));
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`invalid timestamp: ${name}`);
  return normalized;
}

function grantHash(value: Omit<ApprovalGrantInput, "approvedAt"> & { approvedAt: string }): string {
  return canonicalHash({
    approvalId: value.approvalId,
    approvalScope: value.approvalScope,
    approvalSource: value.approvalSource,
    approvalReference: value.approvalReference,
    targetStage: value.targetStage,
    targetSchemaVersion: value.targetSchemaVersion,
    targetContractVersion: value.targetContractVersion,
    approvedAt: value.approvedAt,
    approvalMode: value.approvalMode,
  });
}

function lifecycleHash(value: ApprovalLifecycleInput & { occurredAt: string }): string {
  return canonicalHash({
    lifecycleEventId: value.lifecycleEventId,
    eventKind: value.eventKind,
    subjectApprovalId: value.subjectApprovalId,
    replacementApprovalId: value.replacementApprovalId,
    reason: value.reason,
    source: value.source,
    reference: value.reference,
    occurredAt: value.occurredAt,
  });
}

export function recordApprovalGrant(
  db: DatabaseSync,
  input: ApprovalGrantInput,
  recordedAt = new Date().toISOString(),
): string {
  if (!verifyRolloutSchema(db).approvalSchemaOk) throw new Error("approval schema required");
  const normalized = {
    approvalId: required("approval_id", input.approvalId),
    approvalScope: required("approval_scope", input.approvalScope),
    approvalSource: required("approval_source", input.approvalSource),
    approvalReference: required("approval_reference", input.approvalReference),
    targetStage: required("target_stage", input.targetStage),
    targetSchemaVersion: required("target_schema_version", input.targetSchemaVersion),
    targetContractVersion: required("target_contract_version", input.targetContractVersion),
    approvedAt: instant("approved_at", input.approvedAt),
    approvalMode: input.approvalMode,
  };
  if (!["production", "simulated"].includes(normalized.approvalMode)) {
    throw new Error("approval_mode must be production or simulated");
  }
  const contentHash = grantHash(normalized);
  const existing = db.prepare(`
    SELECT content_hash FROM rollout_approval_grants_v2 WHERE approval_id=?
  `).get(normalized.approvalId) as { content_hash: string } | undefined;
  if (existing) {
    if (existing.content_hash !== contentHash) throw new Error("approval id content conflict");
    return normalized.approvalId;
  }
  db.prepare(`
    INSERT INTO rollout_approval_grants_v2
    (approval_id, approval_scope, approval_source, approval_reference,
     target_stage, target_schema_version, target_contract_version,
     approved_at, approval_mode, content_hash, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalized.approvalId,
    normalized.approvalScope,
    normalized.approvalSource,
    normalized.approvalReference,
    normalized.targetStage,
    normalized.targetSchemaVersion,
    normalized.targetContractVersion,
    normalized.approvedAt,
    normalized.approvalMode,
    contentHash,
    instant("recorded_at", recordedAt),
  );
  return normalized.approvalId;
}

export function recordApprovalLifecycle(
  db: DatabaseSync,
  input: ApprovalLifecycleInput,
  recordedAt = new Date().toISOString(),
): string {
  const normalized: ApprovalLifecycleInput = {
    lifecycleEventId: required("lifecycle_event_id", input.lifecycleEventId),
    eventKind: input.eventKind,
    subjectApprovalId: required("subject_approval_id", input.subjectApprovalId),
    replacementApprovalId: input.replacementApprovalId == null
      ? null
      : required("replacement_approval_id", input.replacementApprovalId),
    reason: required("reason", input.reason),
    source: required("source", input.source),
    reference: required("reference", input.reference),
    occurredAt: instant("occurred_at", input.occurredAt),
  };
  if (normalized.eventKind === "superseded" && !normalized.replacementApprovalId) {
    throw new Error("replacement_approval_id required for superseded");
  }
  if (normalized.eventKind !== "superseded" && normalized.replacementApprovalId) {
    throw new Error("replacement_approval_id only allowed for superseded");
  }
  if (normalized.replacementApprovalId) {
    const replacement = db.prepare(`
      SELECT 1 FROM rollout_approval_grants_v2 WHERE approval_id=?
    `).get(normalized.replacementApprovalId);
    if (!replacement) throw new Error("replacement approval does not exist");
  }
  const contentHash = lifecycleHash(normalized);
  const existing = db.prepare(`
    SELECT content_hash FROM rollout_approval_lifecycle_events_v2 WHERE lifecycle_event_id=?
  `).get(normalized.lifecycleEventId) as { content_hash: string } | undefined;
  if (existing) {
    if (existing.content_hash !== contentHash) throw new Error("approval lifecycle id content conflict");
    return normalized.lifecycleEventId;
  }
  db.prepare(`
    INSERT INTO rollout_approval_lifecycle_events_v2
    (lifecycle_event_id, event_kind, subject_approval_id, replacement_approval_id,
     reason, source, reference, occurred_at, content_hash, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalized.lifecycleEventId,
    normalized.eventKind,
    normalized.subjectApprovalId,
    normalized.replacementApprovalId,
    normalized.reason,
    normalized.source,
    normalized.reference,
    normalized.occurredAt,
    contentHash,
    instant("recorded_at", recordedAt),
  );
  return normalized.lifecycleEventId;
}

export type ApprovalResolution = {
  resolverVersion: string;
  approved: boolean;
  code:
    | "APPROVAL_VALID"
    | "HUMAN_APPROVAL_MISSING"
    | "APPROVAL_SCOPE_MISMATCH"
    | "APPROVAL_TARGET_MISMATCH"
    | "APPROVAL_AFTER_ROLLOUT"
    | "APPROVAL_REVOKED"
    | "APPROVAL_SUPERSEDED"
    | "APPROVAL_HASH_INVALID"
    | "SIMULATED_APPROVAL_NOT_PRODUCTION";
  approvalId: string | null;
  source: string | null;
  reference: string | null;
  approvedAt: string | null;
  mode: ApprovalMode | null;
  legacyApprovalCount: number;
  matchingGrantCount: number;
};

export function resolveApproval(
  db: DatabaseSync,
  input: {
    approvalScope: string;
    targetStage: string;
    targetSchemaVersion: string;
    targetContractVersion: string;
    rolloutStartedAt: string;
    executionMode: ApprovalMode;
  },
): ApprovalResolution {
  const expected = {
    approvalScope: required("approval_scope", input.approvalScope),
    targetStage: required("target_stage", input.targetStage),
    targetSchemaVersion: required("target_schema_version", input.targetSchemaVersion),
    targetContractVersion: required("target_contract_version", input.targetContractVersion),
    rolloutStartedAt: instant("rollout_started_at", input.rolloutStartedAt),
  };
  const legacyApprovalCount = Number((db.prepare(`
    SELECT COUNT(*) count FROM rollout_approval_events
  `).get() as { count: number }).count);
  const rows = db.prepare(`
    SELECT * FROM rollout_approval_grants_v2 ORDER BY approved_at DESC, rowid DESC
  `).all() as ApprovalGrantRow[];
  const sameScope = rows.filter((row) => row.approval_scope === expected.approvalScope);
  const matching = sameScope.filter((row) =>
    row.target_stage === expected.targetStage
    && row.target_schema_version === expected.targetSchemaVersion
    && row.target_contract_version === expected.targetContractVersion);
  const base = {
    resolverVersion: F0R_APPROVAL_RESOLVER_VERSION,
    legacyApprovalCount,
    matchingGrantCount: matching.length,
  };
  if (rows.length === 0) {
    return { ...base, approved: false, code: "HUMAN_APPROVAL_MISSING", approvalId: null, source: null, reference: null, approvedAt: null, mode: null };
  }
  if (sameScope.length === 0) {
    return { ...base, approved: false, code: "APPROVAL_SCOPE_MISMATCH", approvalId: null, source: null, reference: null, approvedAt: null, mode: null };
  }
  if (matching.length === 0) {
    return { ...base, approved: false, code: "APPROVAL_TARGET_MISMATCH", approvalId: null, source: null, reference: null, approvedAt: null, mode: null };
  }
  const row = matching[0];
  const selected = {
    approvalId: row.approval_id,
    source: row.approval_source,
    reference: row.approval_reference,
    approvedAt: row.approved_at,
    mode: row.approval_mode,
  };
  const expectedHash = grantHash({
    approvalId: row.approval_id,
    approvalScope: row.approval_scope,
    approvalSource: row.approval_source,
    approvalReference: row.approval_reference,
    targetStage: row.target_stage,
    targetSchemaVersion: row.target_schema_version,
    targetContractVersion: row.target_contract_version,
    approvedAt: row.approved_at,
    approvalMode: row.approval_mode,
  });
  if (row.content_hash !== expectedHash) {
    return { ...base, ...selected, approved: false, code: "APPROVAL_HASH_INVALID" };
  }
  const lifecycle = db.prepare(`
    SELECT lifecycle_event_id, event_kind, subject_approval_id, replacement_approval_id,
           reason, source, reference, occurred_at, content_hash
    FROM rollout_approval_lifecycle_events_v2
    WHERE subject_approval_id=? ORDER BY occurred_at DESC, rowid DESC LIMIT 1
  `).get(row.approval_id) as {
    lifecycle_event_id: string;
    event_kind: ApprovalLifecycleInput["eventKind"];
    subject_approval_id: string;
    replacement_approval_id: string | null;
    reason: string;
    source: string;
    reference: string;
    occurred_at: string;
    content_hash: string;
  } | undefined;
  if (lifecycle && lifecycle.content_hash !== lifecycleHash({
    lifecycleEventId: lifecycle.lifecycle_event_id,
    eventKind: lifecycle.event_kind,
    subjectApprovalId: lifecycle.subject_approval_id,
    replacementApprovalId: lifecycle.replacement_approval_id,
    reason: lifecycle.reason,
    source: lifecycle.source,
    reference: lifecycle.reference,
    occurredAt: lifecycle.occurred_at,
  })) {
    return { ...base, ...selected, approved: false, code: "APPROVAL_HASH_INVALID" };
  }
  if (lifecycle?.event_kind === "revoked") {
    return { ...base, ...selected, approved: false, code: "APPROVAL_REVOKED" };
  }
  if (lifecycle?.event_kind === "superseded" || lifecycle?.event_kind === "legacy_disqualified") {
    return { ...base, ...selected, approved: false, code: "APPROVAL_SUPERSEDED" };
  }
  if (row.approved_at > expected.rolloutStartedAt) {
    return { ...base, ...selected, approved: false, code: "APPROVAL_AFTER_ROLLOUT" };
  }
  if (input.executionMode === "production" && row.approval_mode !== "production") {
    return { ...base, ...selected, approved: false, code: "SIMULATED_APPROVAL_NOT_PRODUCTION" };
  }
  return { ...base, ...selected, approved: true, code: "APPROVAL_VALID" };
}

export function f0rApprovalTarget() {
  return {
    approvalScope: F0R_APPROVAL_SCOPE,
    targetStage: "F0-R",
    targetSchemaVersion: ROLLOUT_SCHEMA_VERSION,
    targetContractVersion: APPROVAL_CONTRACT_VERSION,
  } as const;
}

export function newApprovalId(): string {
  return randomUUID();
}

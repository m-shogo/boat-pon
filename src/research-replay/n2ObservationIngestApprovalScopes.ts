import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import {
  N2_OFFICIAL_PROGRAM_CANARY_APPROVAL_SCOPE,
  N2_OFFICIAL_PROGRAM_CANARY_CONTRACT_PREFIX,
  N2_OFFICIAL_PROGRAM_CANARY_TARGET_STAGE,
} from "./n2OfficialProgramCanary";
import {
  APPROVAL_CONTRACT_VERSION,
  ROLLOUT_SCHEMA_VERSION,
  SIDECAR_SCHEMA_VERSION,
} from "./schema";

const GRANT_COLUMNS = [
  "approval_id",
  "approval_scope",
  "approval_source",
  "approval_reference",
  "target_stage",
  "target_schema_version",
  "target_contract_version",
  "approved_at",
  "approval_mode",
  "content_hash",
] as const;

const LIFECYCLE_COLUMNS = [
  "lifecycle_event_id",
  "event_kind",
  "subject_approval_id",
  "replacement_approval_id",
  "reason",
  "source",
  "reference",
  "occurred_at",
  "content_hash",
] as const;

type GrantRow = {
  approval_id: string;
  approval_scope: string;
  approval_source: string;
  approval_reference: string;
  target_stage: string;
  target_schema_version: string;
  target_contract_version: string;
  approved_at: string;
  approval_mode: string;
  content_hash: string;
};

type LifecycleRow = {
  lifecycle_event_id: string;
  event_kind: string;
  subject_approval_id: string;
  replacement_approval_id: string | null;
  reason: string;
  source: string;
  reference: string;
  occurred_at: string;
  content_hash: string;
};

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return new Set(
    (db.prepare(`PRAGMA table_info(${quoted})`).all() as unknown as Array<{ name: string }>).map((row) => row.name),
  );
}

function hasColumns(columns: Set<string>, required: readonly string[]): boolean {
  return required.every((column) => columns.has(column));
}

function isCanonicalTimestamp(value: string): boolean {
  try {
    return canonicalUtcTimestamp(value) === value;
  } catch {
    return false;
  }
}

function validOfficialProgramTarget(row: GrantRow): boolean {
  if (row.approval_scope !== N2_OFFICIAL_PROGRAM_CANARY_APPROVAL_SCOPE) return true;
  const expectedSchema = `${ROLLOUT_SCHEMA_VERSION}@${SIDECAR_SCHEMA_VERSION}`;
  const contractPattern = new RegExp(
    `^${N2_OFFICIAL_PROGRAM_CANARY_CONTRACT_PREFIX}:[a-f0-9]{64}:${APPROVAL_CONTRACT_VERSION}$`,
  );
  return row.target_stage === N2_OFFICIAL_PROGRAM_CANARY_TARGET_STAGE
    && row.target_schema_version === expectedSchema
    && contractPattern.test(row.target_contract_version);
}

function validGrant(row: GrantRow): boolean {
  if (!row.approval_id || !row.approval_scope || !row.approval_source || !row.approval_reference) return false;
  if (!row.target_stage || !row.target_schema_version || !row.target_contract_version) return false;
  if (!isCanonicalTimestamp(row.approved_at)) return false;
  if (row.approval_mode !== "production") return false;
  if (!validOfficialProgramTarget(row)) return false;
  const expected = canonicalHash({
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
  return row.content_hash === expected;
}

function validLifecycle(row: LifecycleRow): boolean {
  if (!isCanonicalTimestamp(row.occurred_at)) return false;
  if (!["revoked", "superseded", "legacy_disqualified"].includes(row.event_kind)) return false;
  const expected = canonicalHash({
    lifecycleEventId: row.lifecycle_event_id,
    eventKind: row.event_kind,
    subjectApprovalId: row.subject_approval_id,
    replacementApprovalId: row.replacement_approval_id,
    reason: row.reason,
    source: row.source,
    reference: row.reference,
    occurredAt: row.occurred_at,
  });
  return row.content_hash === expected;
}

export function readLifecycleValidApprovalScopes(sidecarDbPath: string): string[] {
  const db = new DatabaseSync(`${pathToFileURL(sidecarDbPath).href}?immutable=1`, { readOnly: true } as never);
  db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000");
  try {
    if (!tableExists(db, "rollout_approval_grants_v2")) return [];
    if (!hasColumns(tableColumns(db, "rollout_approval_grants_v2"), GRANT_COLUMNS)) return [];
    if (!tableExists(db, "rollout_approval_lifecycle_events_v2")) return [];
    if (!hasColumns(tableColumns(db, "rollout_approval_lifecycle_events_v2"), LIFECYCLE_COLUMNS)) return [];

    const grants = db.prepare(`
      SELECT approval_id, approval_scope, approval_source, approval_reference,
             target_stage, target_schema_version, target_contract_version,
             approved_at, approval_mode, content_hash
      FROM rollout_approval_grants_v2
      ORDER BY approval_scope, approved_at DESC, rowid DESC
    `).all() as unknown as GrantRow[];

    const latestByScope = new Map<string, GrantRow>();
    for (const grant of grants) {
      if (!latestByScope.has(grant.approval_scope)) latestByScope.set(grant.approval_scope, grant);
    }

    const activeScopes: string[] = [];
    for (const [scope, grant] of latestByScope) {
      if (!validGrant(grant)) continue;
      const lifecycle = db.prepare(`
        SELECT lifecycle_event_id, event_kind, subject_approval_id, replacement_approval_id,
               reason, source, reference, occurred_at, content_hash
        FROM rollout_approval_lifecycle_events_v2
        WHERE subject_approval_id=?
        ORDER BY occurred_at DESC, rowid DESC LIMIT 1
      `).get(grant.approval_id) as unknown as LifecycleRow | undefined;
      if (lifecycle) {
        if (!validLifecycle(lifecycle)) continue;
        continue;
      }
      activeScopes.push(scope);
    }
    return activeScopes.sort();
  } finally {
    db.close();
  }
}

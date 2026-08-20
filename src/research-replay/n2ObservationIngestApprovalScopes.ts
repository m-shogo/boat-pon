import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";

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

function validGrant(row: GrantRow): boolean {
  if (!row.approval_id || !row.approval_scope || !row.approval_source || !row.approval_reference) return false;
  if (!row.target_stage || !row.target_schema_version || !row.target_contract_version) return false;
  if (!isCanonicalTimestamp(row.approved_at)) return false;
  if (row.approval_mode !== "production" && row.approval_mode !== "simulated") return false;
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
    const grantColumns = tableColumns(db, "rollout_approval_grants_v2");

    // Preserve compatibility with old synthetic/legacy fixtures that only model approval_scope.
    // Real v2 authority uses the full hashed grant + lifecycle schema below.
    if (!hasColumns(grantColumns, GRANT_COLUMNS)) {
      if (tableExists(db, "rollout_approval_lifecycle_events_v2")) return [];
      const rows = db.prepare(
        "SELECT DISTINCT approval_scope FROM rollout_approval_grants_v2 ORDER BY approval_scope",
      ).all() as unknown as Array<{ approval_scope: string }>;
      return rows.map((row) => row.approval_scope).filter((scope) => typeof scope === "string" && scope.trim() !== "");
    }

    if (!tableExists(db, "rollout_approval_lifecycle_events_v2")) return [];
    const lifecycleColumns = tableColumns(db, "rollout_approval_lifecycle_events_v2");
    if (!hasColumns(lifecycleColumns, LIFECYCLE_COLUMNS)) return [];

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

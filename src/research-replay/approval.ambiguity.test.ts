import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { canonicalHash } from "./canonical";
import { resolveApproval } from "./approval";

function createApprovalDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE rollout_approval_events (
      approval_event_id TEXT PRIMARY KEY
    );
    CREATE TABLE rollout_approval_grants_v2 (
      approval_id TEXT PRIMARY KEY,
      approval_scope TEXT NOT NULL,
      approval_source TEXT NOT NULL,
      approval_reference TEXT NOT NULL,
      target_stage TEXT NOT NULL,
      target_schema_version TEXT NOT NULL,
      target_contract_version TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      approval_mode TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE TABLE rollout_approval_lifecycle_events_v2 (
      lifecycle_event_id TEXT PRIMARY KEY,
      event_kind TEXT NOT NULL,
      subject_approval_id TEXT NOT NULL,
      replacement_approval_id TEXT,
      reason TEXT NOT NULL,
      source TEXT NOT NULL,
      reference TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );
  `);
  return db;
}

function insertGrant(db: DatabaseSync, approvalId: string, approvedAt: string): void {
  const grant = {
    approvalId,
    approvalScope: "TEST_SCOPE",
    approvalSource: "test",
    approvalReference: `ref:${approvalId}`,
    targetStage: "TEST_STAGE",
    targetSchemaVersion: "schema-v1",
    targetContractVersion: "contract-v1",
    approvedAt,
    approvalMode: "production" as const,
  };
  db.prepare(`
    INSERT INTO rollout_approval_grants_v2
    (approval_id, approval_scope, approval_source, approval_reference,
     target_stage, target_schema_version, target_contract_version,
     approved_at, approval_mode, content_hash, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    grant.approvalId,
    grant.approvalScope,
    grant.approvalSource,
    grant.approvalReference,
    grant.targetStage,
    grant.targetSchemaVersion,
    grant.targetContractVersion,
    grant.approvedAt,
    grant.approvalMode,
    canonicalHash(grant),
    approvedAt,
  );
}

function insertLifecycle(
  db: DatabaseSync,
  input: {
    lifecycleEventId: string;
    eventKind: string;
    subjectApprovalId: string;
    replacementApprovalId?: string | null;
    occurredAt: string;
  },
): void {
  const lifecycle = {
    lifecycleEventId: input.lifecycleEventId,
    eventKind: input.eventKind,
    subjectApprovalId: input.subjectApprovalId,
    replacementApprovalId: input.replacementApprovalId ?? null,
    reason: `reason:${input.lifecycleEventId}`,
    source: "test",
    reference: `ref:${input.lifecycleEventId}`,
    occurredAt: input.occurredAt,
  };
  db.prepare(`
    INSERT INTO rollout_approval_lifecycle_events_v2
    (lifecycle_event_id, event_kind, subject_approval_id, replacement_approval_id,
     reason, source, reference, occurred_at, content_hash, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    lifecycle.lifecycleEventId,
    lifecycle.eventKind,
    lifecycle.subjectApprovalId,
    lifecycle.replacementApprovalId,
    lifecycle.reason,
    lifecycle.source,
    lifecycle.reference,
    lifecycle.occurredAt,
    canonicalHash(lifecycle),
    lifecycle.occurredAt,
  );
}

function resolve(db: DatabaseSync) {
  return resolveApproval(db, {
    approvalScope: "TEST_SCOPE",
    targetStage: "TEST_STAGE",
    targetSchemaVersion: "schema-v1",
    targetContractVersion: "contract-v1",
    rolloutStartedAt: "2026-08-20T11:00:00.000Z",
    executionMode: "production",
  });
}

test("same-timestamp matching approvals fail closed instead of using rowid", () => {
  const root = mkdtempSync(join(tmpdir(), "approval-ambiguity-"));
  const path = join(root, "approval.sqlite");
  const db = createApprovalDb(path);
  try {
    insertGrant(db, "approval-a", "2026-08-20T10:00:00.000Z");
    insertGrant(db, "approval-b", "2026-08-20T10:00:00.000Z");
    assert.deepEqual(resolve(db), {
      resolverVersion: "f0r-approval-resolver-v1",
      approved: false,
      code: "APPROVAL_AMBIGUOUS",
      approvalId: null,
      source: null,
      reference: null,
      approvedAt: "2026-08-20T10:00:00.000Z",
      mode: null,
      legacyApprovalCount: 0,
      matchingGrantCount: 2,
    });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("non-canonical persisted approval times fail closed before ordering", () => {
  const root = mkdtempSync(join(tmpdir(), "approval-time-contract-"));
  const path = join(root, "approval.sqlite");
  const db = createApprovalDb(path);
  try {
    insertGrant(db, "approval-offset", "2026-08-20T05:00:00-07:00");
    const resolution = resolve(db);
    assert.equal(resolution.approved, false);
    assert.equal(resolution.code, "APPROVAL_TIMESTAMP_INVALID");
    assert.equal(resolution.approvalId, null);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("same-timestamp lifecycle events fail closed instead of using rowid", () => {
  const root = mkdtempSync(join(tmpdir(), "approval-lifecycle-ambiguity-"));
  const path = join(root, "approval.sqlite");
  const db = createApprovalDb(path);
  try {
    insertGrant(db, "approval-a", "2026-08-20T10:00:00.000Z");
    insertLifecycle(db, {
      lifecycleEventId: "lifecycle-a",
      eventKind: "revoked",
      subjectApprovalId: "approval-a",
      occurredAt: "2026-08-20T10:30:00.000Z",
    });
    insertLifecycle(db, {
      lifecycleEventId: "lifecycle-b",
      eventKind: "legacy_disqualified",
      subjectApprovalId: "approval-a",
      occurredAt: "2026-08-20T10:30:00.000Z",
    });
    const resolution = resolve(db);
    assert.equal(resolution.approved, false);
    assert.equal(resolution.code, "APPROVAL_AMBIGUOUS");
    assert.equal(resolution.approvalId, "approval-a");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("non-canonical lifecycle times fail closed before lifecycle ordering", () => {
  const root = mkdtempSync(join(tmpdir(), "approval-lifecycle-time-contract-"));
  const path = join(root, "approval.sqlite");
  const db = createApprovalDb(path);
  try {
    insertGrant(db, "approval-a", "2026-08-20T10:00:00.000Z");
    insertLifecycle(db, {
      lifecycleEventId: "lifecycle-offset",
      eventKind: "revoked",
      subjectApprovalId: "approval-a",
      occurredAt: "2026-08-20T03:30:00-07:00",
    });
    const resolution = resolve(db);
    assert.equal(resolution.approved, false);
    assert.equal(resolution.code, "APPROVAL_TIMESTAMP_INVALID");
    assert.equal(resolution.approvalId, "approval-a");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("rehashed unknown lifecycle kinds cannot restore approval authority", () => {
  const root = mkdtempSync(join(tmpdir(), "approval-lifecycle-kind-contract-"));
  const path = join(root, "approval.sqlite");
  const db = createApprovalDb(path);
  try {
    insertGrant(db, "approval-a", "2026-08-20T10:00:00.000Z");
    insertLifecycle(db, {
      lifecycleEventId: "lifecycle-unknown",
      eventKind: "restored",
      subjectApprovalId: "approval-a",
      occurredAt: "2026-08-20T10:30:00.000Z",
    });
    const resolution = resolve(db);
    assert.equal(resolution.approved, false);
    assert.equal(resolution.code, "APPROVAL_HASH_INVALID");
    assert.equal(resolution.approvalId, "approval-a");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a unique latest matching approval remains authoritative", () => {
  const root = mkdtempSync(join(tmpdir(), "approval-latest-"));
  const path = join(root, "approval.sqlite");
  const db = createApprovalDb(path);
  try {
    insertGrant(db, "approval-old", "2026-08-20T09:00:00.000Z");
    insertGrant(db, "approval-latest", "2026-08-20T10:00:00.000Z");
    const resolution = resolve(db);
    assert.equal(resolution.approved, true);
    assert.equal(resolution.code, "APPROVAL_VALID");
    assert.equal(resolution.approvalId, "approval-latest");
    assert.equal(resolution.matchingGrantCount, 2);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

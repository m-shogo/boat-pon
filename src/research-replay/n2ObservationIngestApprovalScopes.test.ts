import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { canonicalHash } from "./canonical";
import { readLifecycleValidApprovalScopes } from "./n2ObservationIngestApprovalScopes";

function createAuthorityDb(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE rollout_approval_grants_v2 (
        approval_id TEXT NOT NULL,
        approval_scope TEXT NOT NULL,
        approval_source TEXT NOT NULL,
        approval_reference TEXT NOT NULL,
        target_stage TEXT NOT NULL,
        target_schema_version TEXT NOT NULL,
        target_contract_version TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        approval_mode TEXT NOT NULL,
        content_hash TEXT NOT NULL
      );
      CREATE TABLE rollout_approval_lifecycle_events_v2 (
        lifecycle_event_id TEXT NOT NULL,
        event_kind TEXT NOT NULL,
        subject_approval_id TEXT NOT NULL,
        replacement_approval_id TEXT,
        reason TEXT NOT NULL,
        source TEXT NOT NULL,
        reference TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        content_hash TEXT NOT NULL
      );
    `);
  } finally {
    db.close();
  }
}

function insertGrant(db: DatabaseSync, input: {
  approvalId: string;
  approvalScope: string;
  approvedAt: string;
  approvalMode?: "production" | "simulated";
  contentHash?: string;
}): void {
  const grant = {
    approvalId: input.approvalId,
    approvalScope: input.approvalScope,
    approvalSource: "human-review",
    approvalReference: `ref:${input.approvalId}`,
    targetStage: "N2-CANARY",
    targetSchemaVersion: "schema-v1",
    targetContractVersion: "contract-v1",
    approvedAt: input.approvedAt,
    approvalMode: input.approvalMode ?? "production",
  };
  const contentHash = input.contentHash ?? canonicalHash(grant);
  db.prepare(`
    INSERT INTO rollout_approval_grants_v2
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    contentHash,
  );
}

function insertLifecycle(db: DatabaseSync, input: {
  lifecycleEventId: string;
  eventKind: "revoked" | "superseded" | "legacy_disqualified";
  subjectApprovalId: string;
  replacementApprovalId?: string | null;
  occurredAt: string;
  contentHash?: string;
}): void {
  const event = {
    lifecycleEventId: input.lifecycleEventId,
    eventKind: input.eventKind,
    subjectApprovalId: input.subjectApprovalId,
    replacementApprovalId: input.replacementApprovalId ?? null,
    reason: "test lifecycle",
    source: "test",
    reference: `ref:${input.lifecycleEventId}`,
    occurredAt: input.occurredAt,
  };
  const contentHash = input.contentHash ?? canonicalHash(event);
  db.prepare(`
    INSERT INTO rollout_approval_lifecycle_events_v2
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.lifecycleEventId,
    event.eventKind,
    event.subjectApprovalId,
    event.replacementApprovalId,
    event.reason,
    event.source,
    event.reference,
    event.occurredAt,
    contentHash,
  );
}

test("readiness approval scopes exclude revoked, simulated, and hash-invalid grants", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-readiness-approval-scope-"));
  const path = join(root, "research-replay.sqlite");
  createAuthorityDb(path);
  const db = new DatabaseSync(path);
  try {
    insertGrant(db, {
      approvalId: "approval-active",
      approvalScope: "N2_OFFICIAL_PROGRAM_OBSERVATION_CANARY",
      approvedAt: "2026-08-20T10:00:00.000Z",
    });
    insertGrant(db, {
      approvalId: "approval-revoked",
      approvalScope: "N2_TRIFECTA_MARKET_OBSERVATION_CANARY",
      approvedAt: "2026-08-20T10:01:00.000Z",
    });
    insertLifecycle(db, {
      lifecycleEventId: "lifecycle-revoked",
      eventKind: "revoked",
      subjectApprovalId: "approval-revoked",
      occurredAt: "2026-08-20T10:02:00.000Z",
    });
    insertGrant(db, {
      approvalId: "approval-simulated",
      approvalScope: "N2_SIMULATED_CANARY",
      approvedAt: "2026-08-20T10:02:30.000Z",
      approvalMode: "simulated",
    });
    insertGrant(db, {
      approvalId: "approval-tampered",
      approvalScope: "N2_TAMPERED_CANARY",
      approvedAt: "2026-08-20T10:03:00.000Z",
      contentHash: "0".repeat(64),
    });

    assert.deepEqual(readLifecycleValidApprovalScopes(path), [
      "N2_OFFICIAL_PROGRAM_OBSERVATION_CANARY",
    ]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("latest grant lifecycle is authoritative for a scope", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-readiness-approval-latest-"));
  const path = join(root, "research-replay.sqlite");
  createAuthorityDb(path);
  const db = new DatabaseSync(path);
  try {
    insertGrant(db, {
      approvalId: "approval-old",
      approvalScope: "N2_OFFICIAL_PROGRAM_OBSERVATION_CANARY",
      approvedAt: "2026-08-20T09:00:00.000Z",
    });
    insertGrant(db, {
      approvalId: "approval-new",
      approvalScope: "N2_OFFICIAL_PROGRAM_OBSERVATION_CANARY",
      approvedAt: "2026-08-20T10:00:00.000Z",
    });
    insertLifecycle(db, {
      lifecycleEventId: "lifecycle-superseded",
      eventKind: "superseded",
      subjectApprovalId: "approval-new",
      replacementApprovalId: "approval-old",
      occurredAt: "2026-08-20T10:01:00.000Z",
    });

    assert.deepEqual(readLifecycleValidApprovalScopes(path), []);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy synthetic approval-scope-only schema remains readable", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-readiness-approval-legacy-"));
  const path = join(root, "research-replay.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec("CREATE TABLE rollout_approval_grants_v2 (approval_scope TEXT NOT NULL)");
    db.prepare("INSERT INTO rollout_approval_grants_v2 VALUES(?)").run("SCOPE_B");
    db.prepare("INSERT INTO rollout_approval_grants_v2 VALUES(?)").run("SCOPE_A");
    db.close();
    assert.deepEqual(readLifecycleValidApprovalScopes(path), ["SCOPE_A", "SCOPE_B"]);
  } finally {
    try { db.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { recordApprovalGrant, recordApprovalLifecycle } from "./approval";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

const NOW = "2026-08-22T12:00:00.000Z";

function setup(t: Parameters<typeof test>[1] extends (arg: infer T) => unknown ? T : never) {
  const root = mkdtempSync(join(tmpdir(), "approval-lifecycle-chronology-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const db = openRolloutDatabase(join(root, "research-replay.sqlite"));
  t.after(() => db.close());
  initializeRolloutSchema(db, NOW);
  return db;
}

function grant(db: ReturnType<typeof openRolloutDatabase>, approvalId: string, approvedAt: string) {
  recordApprovalGrant(db, {
    approvalId,
    approvalScope: "TEST_SCOPE",
    approvalSource: "test",
    approvalReference: `test:${approvalId}`,
    targetStage: "TEST_STAGE",
    targetSchemaVersion: "schema-v1",
    targetContractVersion: "contract-v1",
    approvedAt,
    approvalMode: "production",
  }, NOW);
}

test("approval lifecycle cannot predate its subject grant", (t) => {
  const db = setup(t);
  grant(db, "subject", "2026-08-22T10:00:00.000Z");
  assert.throws(() => recordApprovalLifecycle(db, {
    lifecycleEventId: "revoke-before-grant",
    eventKind: "revoked",
    subjectApprovalId: "subject",
    replacementApprovalId: null,
    reason: "withdrawn",
    source: "test",
    reference: "test:revoke-before-grant",
    occurredAt: "2026-08-22T09:59:59.000Z",
  }, NOW), /predates subject approval/);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM rollout_approval_lifecycle_events_v2").get() as { count: number }).count, 0);
});

test("supersession lifecycle cannot predate the replacement grant", (t) => {
  const db = setup(t);
  grant(db, "subject", "2026-08-22T10:00:00.000Z");
  grant(db, "replacement", "2026-08-22T10:30:00.000Z");
  assert.throws(() => recordApprovalLifecycle(db, {
    lifecycleEventId: "supersede-before-replacement",
    eventKind: "superseded",
    subjectApprovalId: "subject",
    replacementApprovalId: "replacement",
    reason: "new contract",
    source: "test",
    reference: "test:supersede-before-replacement",
    occurredAt: "2026-08-22T10:15:00.000Z",
  }, NOW), /predates replacement approval/);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM rollout_approval_lifecycle_events_v2").get() as { count: number }).count, 0);
});

test("supersession cannot replace an approval with itself", (t) => {
  const db = setup(t);
  grant(db, "subject", "2026-08-22T10:00:00.000Z");
  assert.throws(() => recordApprovalLifecycle(db, {
    lifecycleEventId: "self-supersede",
    eventKind: "superseded",
    subjectApprovalId: "subject",
    replacementApprovalId: "subject",
    reason: "invalid self replacement",
    source: "test",
    reference: "test:self-supersede",
    occurredAt: "2026-08-22T11:00:00.000Z",
  }, NOW), /must differ from subject approval/);
});

test("chronological supersession remains append-only and valid", (t) => {
  const db = setup(t);
  grant(db, "subject", "2026-08-22T10:00:00.000Z");
  grant(db, "replacement", "2026-08-22T10:30:00.000Z");
  const input = {
    lifecycleEventId: "valid-supersede",
    eventKind: "superseded" as const,
    subjectApprovalId: "subject",
    replacementApprovalId: "replacement",
    reason: "new contract",
    source: "test",
    reference: "test:valid-supersede",
    occurredAt: "2026-08-22T11:00:00.000Z",
  };
  assert.equal(recordApprovalLifecycle(db, input, NOW), "valid-supersede");
  assert.equal(recordApprovalLifecycle(db, input, NOW), "valid-supersede");
  assert.equal((db.prepare("SELECT COUNT(*) count FROM rollout_approval_lifecycle_events_v2").get() as { count: number }).count, 1);
});

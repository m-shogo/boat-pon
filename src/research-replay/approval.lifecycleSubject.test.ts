import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { recordApprovalGrant, recordApprovalLifecycle } from "./approval";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

const NOW = "2026-08-22T08:00:00.000Z";

function lifecycleInput() {
  return {
    lifecycleEventId: "lifecycle-before-subject",
    eventKind: "revoked" as const,
    subjectApprovalId: "future-grant",
    replacementApprovalId: null,
    reason: "withdrawn",
    source: "test",
    reference: "test:future-grant",
    occurredAt: "2026-08-22T07:59:00.000Z",
  };
}

test("approval lifecycle cannot poison an approval id before the subject grant exists", (t) => {
  const root = mkdtempSync(join(tmpdir(), "approval-lifecycle-subject-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const db = openRolloutDatabase(join(root, "research-replay.sqlite"));
  t.after(() => db.close());
  initializeRolloutSchema(db, NOW);

  assert.throws(
    () => recordApprovalLifecycle(db, lifecycleInput(), NOW),
    /subject approval does not exist/,
  );
  assert.equal((db.prepare(`
    SELECT COUNT(*) count FROM rollout_approval_lifecycle_events_v2
  `).get() as { count: number }).count, 0);

  recordApprovalGrant(db, {
    approvalId: "future-grant",
    approvalScope: "TEST_SCOPE",
    approvalSource: "test",
    approvalReference: "test:future-grant",
    targetStage: "TEST_STAGE",
    targetSchemaVersion: "schema-v1",
    targetContractVersion: "contract-v1",
    approvedAt: "2026-08-22T07:58:00.000Z",
    approvalMode: "production",
  }, NOW);

  assert.equal(recordApprovalLifecycle(db, lifecycleInput(), NOW), "lifecycle-before-subject");
  assert.equal((db.prepare(`
    SELECT COUNT(*) count FROM rollout_approval_lifecycle_events_v2
    WHERE lifecycle_event_id='lifecycle-before-subject'
  `).get() as { count: number }).count, 1);
});

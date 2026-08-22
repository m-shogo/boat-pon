import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { initializeSidecarSchema, initializeRolloutSchema, openSidecarDatabase } from "./schema";
import { recordApprovalGrant, recordApprovalLifecycle } from "./approval";
import {
  REPARSE_APPLY_SCOPE, REPARSE_APPLY_TARGET_STAGE, computeApprovalTargetDigest,
  reparseApplyTargetContractVersion, reparseApplyTargetSchemaVersion, resolveReparseApplyGate,
} from "./n2SettlementReparseApply";

const NOW = "2026-08-03T00:00:00.000Z";
const SOURCE_SHA = "d9b5ddd264ea138f319b04a8fb9398f1048bb2ad3001055ffe319616d6b6cb92";
const SCHEMA = "n1-settlement.0.3";
const IDENTITY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // settlement-content identity

function setup(): DatabaseSync {
  const root = mkdtempSync(join(tmpdir(), "reparse-apply-gate-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, NOW);
  initializeRolloutSchema(db, NOW);
  return db;
}

const binding = {
  reparseSchemaVersion: "n2-settlement-reparse-v1",
  snapshotIdentity: { settlementSnapshotIdentity: IDENTITY, settlementSchema: SCHEMA, sourceSha256: SOURCE_SHA, sourceBytes: 9019846656 },
  falseRefundCorrections: 317747, specialPayoutAdditions: 65156, outputDigest: "247310fb",
};
const DIGEST = computeApprovalTargetDigest(binding);

function manifest(overrides: Partial<{ approvalStatus: string; approvalTargetDigest: string; productionApplyCodeGitSha: string | null }> = {}) {
  return {
    manifestSchemaVersion: "n2-settlement-reparse-approval-manifest-v3",
    approvalStatus: "APPROVAL_INTENT",
    approvalTargetDigest: DIGEST, binding,
    productionApplyCodeGitSha: null,
    ...overrides,
  };
}
function onDisk(overrides: Partial<{ settlementSnapshotIdentity: string; sourceSha256: string; sourceBytes: number; settlementSchema: string; hasActiveWal: boolean; diskFreeBytes: number; neededBytes: number; codeGitSha: string | null }> = {}) {
  return {
    settlementSnapshotIdentity: IDENTITY, sourceSha256: SOURCE_SHA, sourceBytes: 9019846656, settlementSchema: SCHEMA,
    hasActiveWal: false, diskFreeBytes: 50e9, neededBytes: 20e9, codeGitSha: null, ...overrides,
  };
}
function grant(db: DatabaseSync, opts: { mode?: "production" | "simulated"; approvedAt?: string; digest?: string; approvalId?: string } = {}): string {
  const approvalId = opts.approvalId ?? "reparse-apply-grant-1";
  recordApprovalGrant(db, {
    approvalId, approvalScope: REPARSE_APPLY_SCOPE, approvalSource: "human_work_order_reparse_apply",
    approvalReference: "work-order:reparse-apply", targetStage: REPARSE_APPLY_TARGET_STAGE,
    targetSchemaVersion: reparseApplyTargetSchemaVersion(SCHEMA, IDENTITY),
    targetContractVersion: reparseApplyTargetContractVersion(opts.digest ?? DIGEST),
    approvedAt: opts.approvedAt ?? "2026-08-02T00:00:00.000Z", approvalMode: opts.mode ?? "production",
  }, NOW);
  return approvalId;
}

const ROLL = "2026-08-03T12:00:00.000Z"; // rolloutStartedAt（approval より後）

test("no approval grant → BLOCKED (HUMAN_APPROVAL_MISSING)", () => {
  const db = setup();
  const r = resolveReparseApplyGate(db, { manifest: manifest(), onDisk: onDisk(), executionMode: "production", rolloutStartedAt: ROLL });
  assert.equal(r.approved, false);
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.exitCode, 3);
  assert.ok(r.blocks.includes("APPROVAL_HUMAN_APPROVAL_MISSING"));
  db.close();
});

test("valid production approval + matching snapshot/digest → PASS", () => {
  const db = setup();
  grant(db, { mode: "production" });
  const r = resolveReparseApplyGate(db, { manifest: manifest(), onDisk: onDisk(), executionMode: "production", rolloutStartedAt: ROLL });
  assert.deepEqual(r.blocks, []);
  assert.equal(r.approved, true);
  assert.equal(r.status, "PASS");
  assert.equal(r.exitCode, 0);
  assert.equal(r.approval.code, "APPROVAL_VALID");
  db.close();
});

test("manifest digest mismatch → BLOCKED", () => {
  const db = setup();
  grant(db);
  const r = resolveReparseApplyGate(db, { manifest: manifest({ approvalTargetDigest: "0".repeat(64) }), onDisk: onDisk(), executionMode: "production", rolloutStartedAt: ROLL });
  assert.ok(r.blocks.includes("MANIFEST_DIGEST_MISMATCH"));
  assert.equal(r.approved, false);
  db.close();
});

test("settlement snapshot identity mismatch → BLOCKED", () => {
  const db = setup();
  grant(db);
  const r = resolveReparseApplyGate(db, { manifest: manifest(), onDisk: onDisk({ settlementSnapshotIdentity: "f".repeat(64) }), executionMode: "production", rolloutStartedAt: ROLL });
  assert.ok(r.blocks.includes("SETTLEMENT_SNAPSHOT_IDENTITY_MISMATCH"));
  assert.equal(r.approved, false);
  db.close();
});

test("whole-file SHA/size are advisory (NOT blocking) — grant recording changes them", () => {
  const db = setup();
  grant(db);
  // settlement identity 一致なら、whole-file SHA/size が変わっても PASS（grant 記録で変化するため）。
  const r = resolveReparseApplyGate(db, { manifest: manifest(), onDisk: onDisk({ sourceSha256: "1".repeat(64), sourceBytes: 123 }), executionMode: "production", rolloutStartedAt: ROLL });
  assert.deepEqual(r.blocks, []);
  assert.equal(r.approved, true);
  db.close();
});

test("schema identity mismatch → BLOCKED", () => {
  const db = setup();
  grant(db);
  const r = resolveReparseApplyGate(db, { manifest: manifest(), onDisk: onDisk({ settlementSchema: "n1-settlement.0.2" }), executionMode: "production", rolloutStartedAt: ROLL });
  assert.ok(r.blocks.includes("SCHEMA_IDENTITY_MISMATCH"));
  db.close();
});

test("simulated approval used in production → BLOCKED", () => {
  const db = setup();
  grant(db, { mode: "simulated" });
  const r = resolveReparseApplyGate(db, { manifest: manifest(), onDisk: onDisk(), executionMode: "production", rolloutStartedAt: ROLL });
  assert.ok(r.blocks.includes("APPROVAL_SIMULATED_APPROVAL_NOT_PRODUCTION"));
  db.close();
});

test("revoked approval → BLOCKED", () => {
  const db = setup();
  const id = grant(db);
  recordApprovalLifecycle(db, { lifecycleEventId: "lc-1", eventKind: "revoked", subjectApprovalId: id, replacementApprovalId: null, reason: "rollback", source: "human", reference: "wo", occurredAt: "2026-08-02T06:00:00.000Z" }, NOW);
  const r = resolveReparseApplyGate(db, { manifest: manifest(), onDisk: onDisk(), executionMode: "production", rolloutStartedAt: ROLL });
  assert.ok(r.blocks.includes("APPROVAL_APPROVAL_REVOKED"));
  db.close();
});

test("newer superseding target blocks the older matching approval", () => {
  const db = setup();
  const id = grant(db); // older matching grant for the target
  // A newer same-scope grant is the current authority even when it targets a different digest.
  grant(db, { approvalId: "reparse-apply-grant-2", digest: "f".repeat(64), approvedAt: "2026-08-02T01:00:00.000Z" });
  recordApprovalLifecycle(db, { lifecycleEventId: "lc-2", eventKind: "superseded", subjectApprovalId: id, replacementApprovalId: "reparse-apply-grant-2", reason: "new digest", source: "human", reference: "wo", occurredAt: "2026-08-02T06:00:00.000Z" }, NOW);
  const r = resolveReparseApplyGate(db, { manifest: manifest(), onDisk: onDisk(), executionMode: "production", rolloutStartedAt: ROLL });
  assert.ok(r.blocks.includes("APPROVAL_APPROVAL_TARGET_MISMATCH"));
  db.close();
});

test("active WAL → BLOCKED", () => {
  const db = setup();
  grant(db);
  const r = resolveReparseApplyGate(db, { manifest: manifest(), onDisk: onDisk({ hasActiveWal: true }), executionMode: "production", rolloutStartedAt: ROLL });
  assert.ok(r.blocks.includes("ACTIVE_WAL"));
  db.close();
});

test("insufficient disk → BLOCKED", () => {
  const db = setup();
  grant(db);
  const r = resolveReparseApplyGate(db, { manifest: manifest(), onDisk: onDisk({ diskFreeBytes: 1, neededBytes: 20e9 }), executionMode: "production", rolloutStartedAt: ROLL });
  assert.ok(r.blocks.includes("INSUFFICIENT_DISK"));
  db.close();
});

test("mode=simulated → BLOCKED (production apply requires production mode)", () => {
  const db = setup();
  grant(db);
  const r = resolveReparseApplyGate(db, { manifest: manifest(), onDisk: onDisk(), executionMode: "simulated", rolloutStartedAt: ROLL });
  assert.ok(r.blocks.includes("MODE_NOT_PRODUCTION"));
  assert.equal(r.approved, false);
  db.close();
});

test("manifest marked NOT_APPROVED → BLOCKED", () => {
  const db = setup();
  grant(db);
  const r = resolveReparseApplyGate(db, { manifest: manifest({ approvalStatus: "NOT_APPROVED" }), onDisk: onDisk(), executionMode: "production", rolloutStartedAt: ROLL });
  assert.ok(r.blocks.includes("MANIFEST_MARKED_NOT_APPROVED"));
  db.close();
});

test("code SHA mismatch → BLOCKED", () => {
  const db = setup();
  grant(db);
  const r = resolveReparseApplyGate(db, {
    manifest: manifest({ productionApplyCodeGitSha: "aaaa" }), onDisk: onDisk({ codeGitSha: "bbbb" }),
    executionMode: "production", rolloutStartedAt: ROLL,
  });
  assert.ok(r.blocks.includes("CODE_SHA_MISMATCH"));
  db.close();
});

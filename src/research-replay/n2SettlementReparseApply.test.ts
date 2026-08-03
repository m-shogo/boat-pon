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

function setup(): DatabaseSync {
  const root = mkdtempSync(join(tmpdir(), "reparse-apply-gate-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, NOW);
  initializeRolloutSchema(db, NOW);
  return db;
}

const binding = {
  reparseSchemaVersion: "n2-settlement-reparse-v1",
  snapshotIdentity: { sourceSha256: SOURCE_SHA, sourceBytes: 9019846656, settlementSchema: SCHEMA },
  falseRefundCorrections: 317747, specialPayoutAdditions: 65156, outputDigest: "247310fb",
};
const DIGEST = computeApprovalTargetDigest(binding);

function manifest(overrides: Partial<{ approvalStatus: string; approvalTargetDigest: string; productionApplyCodeGitSha: string | null }> = {}) {
  return {
    manifestSchemaVersion: "n2-settlement-reparse-approval-manifest-v2",
    approvalStatus: "APPROVAL_INTENT",
    approvalTargetDigest: DIGEST, binding,
    productionApplyCodeGitSha: null,
    ...overrides,
  };
}
function onDisk(overrides: Partial<{ sourceSha256: string; sourceBytes: number; settlementSchema: string; hasActiveWal: boolean; diskFreeBytes: number; neededBytes: number; codeGitSha: string | null }> = {}) {
  return {
    sourceSha256: SOURCE_SHA, sourceBytes: 9019846656, settlementSchema: SCHEMA,
    hasActiveWal: false, diskFreeBytes: 50e9, neededBytes: 20e9, codeGitSha: null, ...overrides,
  };
}
function grant(db: DatabaseSync, opts: { mode?: "production" | "simulated"; approvedAt?: string; digest?: string; approvalId?: string } = {}): string {
  const approvalId = opts.approvalId ?? "reparse-apply-grant-1";
  recordApprovalGrant(db, {
    approvalId, approvalScope: REPARSE_APPLY_SCOPE, approvalSource: "human_work_order_reparse_apply",
    approvalReference: "work-order:reparse-apply", targetStage: REPARSE_APPLY_TARGET_STAGE,
    targetSchemaVersion: reparseApplyTargetSchemaVersion(SCHEMA, SOURCE_SHA),
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

test("source snapshot SHA mismatch → BLOCKED", () => {
  const db = setup();
  grant(db);
  const r = resolveReparseApplyGate(db, { manifest: manifest(), onDisk: onDisk({ sourceSha256: "1".repeat(64) }), executionMode: "production", rolloutStartedAt: ROLL });
  assert.ok(r.blocks.includes("SOURCE_SNAPSHOT_SHA_MISMATCH"));
  db.close();
});

test("source size mismatch → BLOCKED", () => {
  const db = setup();
  grant(db);
  const r = resolveReparseApplyGate(db, { manifest: manifest(), onDisk: onDisk({ sourceBytes: 123 }), executionMode: "production", rolloutStartedAt: ROLL });
  assert.ok(r.blocks.includes("SOURCE_SIZE_MISMATCH"));
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

test("superseded approval → BLOCKED", () => {
  const db = setup();
  const id = grant(db); // only matching grant for the target
  // replacement points to a grant with a DIFFERENT digest (does not match the gate target).
  grant(db, { approvalId: "reparse-apply-grant-2", digest: "f".repeat(64) });
  recordApprovalLifecycle(db, { lifecycleEventId: "lc-2", eventKind: "superseded", subjectApprovalId: id, replacementApprovalId: "reparse-apply-grant-2", reason: "new digest", source: "human", reference: "wo", occurredAt: "2026-08-02T06:00:00.000Z" }, NOW);
  const r = resolveReparseApplyGate(db, { manifest: manifest(), onDisk: onDisk(), executionMode: "production", rolloutStartedAt: ROLL });
  assert.ok(r.blocks.includes("APPROVAL_APPROVAL_SUPERSEDED"));
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

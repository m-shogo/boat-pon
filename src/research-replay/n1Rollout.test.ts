import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { recordApprovalGrant } from "./approval";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";
import {
  N1_SETTLEMENT_MIGRATION_CHECKSUM,
  N1_SETTLEMENT_SCHEMA_VERSION,
  verifyN1SettlementSchema,
} from "./settlement";
import {
  n1bApprovalTarget,
  N1B_APPROVAL_SCOPE,
  N1B_TARGET_CONTRACT,
  N1B_TARGET_STAGE,
  probePrimaryReadOnly,
  runN1PermanentRollout,
} from "./n1Rollout";
import { selectSampleFiles } from "./n1CapacityBenchmark";

const NOW = "2026-07-25T03:00:00.000Z";
const APPROVED_AT = "2026-07-25T02:00:00.000Z";
const FIXTURE = join("tests", "fixtures", "research-replay", "n1-settlement-cases.json");
const ARCHIVE_ROOT = join("data", "raw", "official", "results");

function scaffold() {
  const root = mkdtempSync(join(tmpdir(), "n1b-rollout-test-"));
  const sidecarPath = join(root, "data", "research-replay.sqlite");
  const primaryPath = join(root, "primary.sqlite");
  const primary = new DatabaseSync(primaryPath);
  primary.exec(`
    CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO app_settings VALUES ('mode', 'read_only_fixture');
  `);
  primary.close();
  const db = openRolloutDatabase(sidecarPath);
  initializeRolloutSchema(db, NOW);
  db.close();
  return { root, sidecarPath, primaryPath };
}

function grant(sidecarPath: string) {
  const db = openRolloutDatabase(sidecarPath);
  initializeRolloutSchema(db, NOW);
  const target = n1bApprovalTarget();
  recordApprovalGrant(db, {
    approvalId: "n1b-test-approval",
    approvalScope: N1B_APPROVAL_SCOPE,
    approvalSource: "unit_test_human_fixture",
    approvalReference: `n1-settlement.0.1/${N1_SETTLEMENT_MIGRATION_CHECKSUM}`,
    targetStage: target.targetStage,
    targetSchemaVersion: target.targetSchemaVersion,
    targetContractVersion: target.targetContractVersion,
    approvedAt: APPROVED_AT,
    approvalMode: "simulated",
  }, NOW);
  db.close();
}

function run(input: { sidecarPath: string; primaryPath: string; root: string; apply: boolean; generatedAt?: string }) {
  return runN1PermanentRollout({
    sidecarPath: input.sidecarPath,
    rawRoot: join(input.root, "data", "research-replay-raw"),
    primarySourcePath: input.primaryPath,
    backupDirectory: join(input.root, "backups"),
    fixturePath: FIXTURE,
    rolloutStartedAt: NOW,
    executionMode: "simulated",
    apply: input.apply,
    capacityFitsQuota: true,
    evidencePinReductionRequired: false,
    reportRoot: input.root,
    generatedAt: input.generatedAt ?? NOW,
  });
}

test("N1-B blocks apply without explicit N1-B approval; F0-R scope is not reused", () => {
  const ctx = scaffold();
  const report = run({ ...ctx, apply: true });
  assert.equal(report.status, "BLOCKED");
  assert.equal(report.applied, false);
  assert.equal(report.approval.approved, false);
  assert.equal(report.approval.resolution.code, "HUMAN_APPROVAL_MISSING");
  assert.deepEqual(report.approval.scope, N1B_APPROVAL_SCOPE);
  assert.equal(report.approval.targetStage, N1B_TARGET_STAGE);
  assert.equal(report.approval.targetContractVersion, N1B_TARGET_CONTRACT);
});

test("N1-B applies zero-data schema, checksum, triggers and canary under explicit approval", () => {
  const ctx = scaffold();
  grant(ctx.sidecarPath);
  const report = run({ ...ctx, apply: true });
  assert.equal(report.approval.approved, true);
  assert.equal(report.applied, true);
  assert.equal(report.status, "COMPLETE");
  assert.equal(report.schema.afterVersion, N1_SETTLEMENT_SCHEMA_VERSION);
  assert.equal(report.schema.migrationChecksum, N1_SETTLEMENT_MIGRATION_CHECKSUM);
  assert.equal(report.schema.checksumMatches, true);
  assert.equal(report.schema.appendOnlyTriggerCount, 14);
  assert.equal(report.schema.integrityCheck, "ok");
  assert.equal(report.schema.foreignKeyViolations, 0);
  // 永続sidecarはzero-data。
  assert.ok(Object.values(report.schema.permanentRowCounts).every((count) => count === 0));
  assert.equal(report.postMigrationGate?.zeroDataN1, true);
  // primary read-only 証明。
  assert.equal(report.primaryIsolationBefore.readOnlyConnection, true);
  assert.equal(report.primaryIsolationBefore.queryOnlyEnforced, true);
  assert.equal(report.primaryIsolationBefore.writeStatementCount, 0);
  assert.equal(report.primaryIsolationBefore.writeConnectionCount, 0);
  assert.equal(report.primaryUnchanged, true);
  // restore-copy canary。
  assert.equal(report.canary?.fixtures, 20);
  assert.equal(report.canary?.idempotencyHeld, true);
  assert.equal(report.canary?.conflictCreated, true);
  assert.equal(report.canary?.correctionApplied, true);
  assert.equal(report.canary?.appendOnlyEnforced, true);
  assert.equal(report.canary?.gcPinRespected, true);
  assert.equal(report.canary?.evidencePinsPerCandidate, 3);
  assert.equal(report.canary?.parseErrorCreatesNoCandidate, true);
  assert.equal(report.canary?.backupRestoreHashMatch, true);
  assert.equal(report.blockers.length, 0);

  // 永続sidecar側でN1 schemaが実際にappliedになっている。
  const db = openRolloutDatabase(ctx.sidecarPath);
  assert.equal(verifyN1SettlementSchema(db).ok, true);
  db.close();
});

test("re-running apply is idempotent and keeps zero-data", () => {
  const ctx = scaffold();
  grant(ctx.sidecarPath);
  run({ ...ctx, apply: true, generatedAt: "2026-07-25T03:00:00.000Z" });
  const second = run({ ...ctx, apply: true, generatedAt: "2026-07-25T04:00:00.000Z" });
  assert.equal(second.applied, true);
  assert.equal(second.schema.checksumMatches, true);
  assert.ok(Object.values(second.schema.permanentRowCounts).every((count) => count === 0));
});

test("capacity sample selection is deterministic and stratified", () => {
  const a = selectSampleFiles(ARCHIVE_ROOT, 2000);
  const b = selectSampleFiles(ARCHIVE_ROOT, 2000);
  assert.deepEqual(a.files, b.files);
  assert.ok(a.files.length > 0);
  // 3 decade strataを跨ぐ。
  assert.ok(Object.keys(a.strataCounts).length >= 2);
});

test("primary probe proves read-only and separation from target sidecar", () => {
  const ctx = scaffold();
  const probe = probePrimaryReadOnly(ctx.primaryPath, ctx.sidecarPath);
  assert.equal(probe.readOnlyConnection, true);
  assert.equal(probe.queryOnlyEnforced, true);
  assert.equal(probe.writeStatementCount, 0);
  assert.equal(probe.targetIsNotPrimary, true);
  assert.equal(probe.mainPathIsPrimary, true);
  assert.deepEqual(probe.attachedDatabases, []);
});

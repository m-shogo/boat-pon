import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { recordApprovalGrant, recordApprovalLifecycle } from "./approval";
import { DEFAULT_ROLLOUT_CONFIG, RolloutController } from "./rollout";
import {
  evaluateShadowOperabilityGate,
  shadowOperabilityApprovalTarget,
  type ShadowOperabilityPolicy,
} from "./shadowOperabilityPolicy";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

const policy: ShadowOperabilityPolicy = {
  contractVersion: "shadow-operability-policy-v1",
  policyVersion: "fixture-operability-v1",
  diagnosticsWindowMs: 60_000,
  thresholds: {
    maxQueued: 10,
    maxReadyQueued: 10,
    maxOldestQueuedAgeMs: 300_000,
    maxRetrying: 2,
    maxPermanentlyFailed: 0,
    maxRetryExhausted: 0,
    maxContentionRate: 0.25,
    maxHandlerDeadlineExceeded: 0,
  },
};

function context() {
  const root = mkdtempSync(join(tmpdir(), "shadow-operability-policy-"));
  const dbPath = join(root, "sidecar.sqlite");
  const db = openRolloutDatabase(dbPath);
  initializeRolloutSchema(db, "2026-08-02T05:00:00.000Z");
  const rawStore = new RawStore(join(root, "raw"));
  let sequence = 0;
  const now = () => "2026-08-02T05:00:00.000Z";
  const repository = new ResearchReplayRepository(db, rawStore, () => `policy-${++sequence}`, now);
  const controller = new RolloutController(
    db,
    repository,
    rawStore,
    () => `policy-${++sequence}`,
    now,
    () => Number.MAX_SAFE_INTEGER,
  );
  controller.recordConfig({ ...DEFAULT_ROLLOUT_CONFIG, diskLowWaterBytes: 0 }, "fixture default off");
  return { root, dbPath, db };
}

function grant(ctx: ReturnType<typeof context>, mode: "simulated" | "production") {
  const target = shadowOperabilityApprovalTarget(policy);
  recordApprovalGrant(ctx.db, {
    approvalId: `operability-${mode}`,
    approvalScope: target.approvalScope,
    approvalSource: "fixture",
    approvalReference: `fixture://${mode}`,
    targetStage: target.targetStage,
    targetSchemaVersion: target.targetSchemaVersion,
    targetContractVersion: target.targetContractVersion,
    approvedAt: "2026-08-02T05:00:00.000Z",
    approvalMode: mode,
  }, "2026-08-02T05:00:00.000Z");
}

test("missing, simulated-production, and revoked approval all block the gate", () => {
  const ctx = context();
  try {
    const missing = evaluateShadowOperabilityGate(ctx.db, {
      policy,
      asOf: "2026-08-02T05:00:01.000Z",
      executionMode: "simulated",
    });
    assert.equal(missing.status, "BLOCKED");
    assert.deepEqual(missing.reasons, ["approval:HUMAN_APPROVAL_MISSING"]);

    grant(ctx, "simulated");
    const simulated = evaluateShadowOperabilityGate(ctx.db, {
      policy,
      asOf: "2026-08-02T05:00:01.000Z",
      executionMode: "simulated",
    });
    assert.equal(simulated.status, "PASS");
    assert.equal(simulated.approval.code, "APPROVAL_VALID");
    const production = evaluateShadowOperabilityGate(ctx.db, {
      policy,
      asOf: "2026-08-02T05:00:01.000Z",
      executionMode: "production",
    });
    assert.equal(production.status, "BLOCKED");
    assert.ok(production.reasons.includes("approval:SIMULATED_APPROVAL_NOT_PRODUCTION"));

    recordApprovalLifecycle(ctx.db, {
      lifecycleEventId: "revoke-operability-simulated",
      eventKind: "revoked",
      subjectApprovalId: "operability-simulated",
      replacementApprovalId: null,
      reason: "fixture revoke",
      source: "fixture",
      reference: "fixture://revoke",
      occurredAt: "2026-08-02T05:00:00.500Z",
    }, "2026-08-02T05:00:00.500Z");
    const revoked = evaluateShadowOperabilityGate(ctx.db, {
      policy,
      asOf: "2026-08-02T05:00:01.000Z",
      executionMode: "simulated",
    });
    assert.equal(revoked.status, "BLOCKED");
    assert.ok(revoked.reasons.includes("approval:APPROVAL_REVOKED"));
  } finally {
    ctx.db.close();
    rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("policy mutation cannot reuse approval for a different digest", () => {
  const ctx = context();
  try {
    grant(ctx, "simulated");
    const changed = structuredClone(policy);
    changed.thresholds.maxQueued = 11;
    const gate = evaluateShadowOperabilityGate(ctx.db, {
      policy: changed,
      asOf: "2026-08-02T05:00:01.000Z",
      executionMode: "simulated",
    });
    assert.equal(gate.status, "BLOCKED");
    assert.ok(gate.reasons.includes("approval:APPROVAL_TARGET_MISMATCH"));
    assert.notEqual(gate.policyDigest, shadowOperabilityApprovalTarget(policy).policyDigest);
  } finally {
    ctx.db.close();
    rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("CLI opens the sidecar immutable/read-only and returns deterministic PASS", () => {
  const ctx = context();
  const policyPath = join(ctx.root, "policy.json");
  try {
    grant(ctx, "simulated");
    writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
    ctx.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    ctx.db.close();
    const cli = resolve("run29/scripts/report-shadow-operability.ts");
    const args = [
      ...process.execArgv,
      cli,
      `--sidecar=${ctx.dbPath}`,
      `--policy=${policyPath}`,
      "--as-of=2026-08-02T05:00:01.000Z",
      "--mode=simulated",
    ];
    const first = spawnSync(process.execPath, args, { encoding: "utf8" });
    const second = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    const firstGate = JSON.parse(first.stdout) as { status: string; digest: string };
    const secondGate = JSON.parse(second.stdout) as { status: string; digest: string };
    assert.equal(firstGate.status, "PASS");
    assert.equal(secondGate.digest, firstGate.digest);
    assert.equal(readFileSync(policyPath, "utf8"), `${JSON.stringify(policy, null, 2)}\n`);
    writeFileSync(`${ctx.dbPath}-wal`, "not-a-quiescent-snapshot", "utf8");
    const unsafe = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.notEqual(unsafe.status, 0);
    assert.match(unsafe.stderr, /SHADOW_OPERABILITY_ACTIVE_WAL_REJECTED_USE_QUIESCENT_SNAPSHOT/);
  } finally {
    try { ctx.db.close(); } catch { /* already closed */ }
    rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("policy decoder rejects unknown fields instead of silently accepting drift", () => {
  const ctx = context();
  try {
    assert.throws(() => evaluateShadowOperabilityGate(ctx.db, {
      policy: { ...policy, productionReady: true },
      asOf: "2026-08-02T05:00:01.000Z",
      executionMode: "simulated",
    }), /invalid shadow operability policy fields/);
  } finally {
    ctx.db.close();
    rmSync(ctx.root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  checkNoSecrets, checkProductionIsolation, checkWriteScope, idempotencyKey, runExecutorLifecycle,
  type ExecutorSpec, type SdkContext,
} from "./executorSdk";

const ctx: SdkContext = { repoRoot: "/x", runId: "r1", taskId: "TASK-T", dataRoot: "/x", dryRun: false, writeAllowlist: ["reports/n2/"] };

const okSpec = (o: Partial<ExecutorSpec> = {}): ExecutorSpec => ({
  name: "demo", safetyLevel: "L0", implemented: true,
  inputContract: () => ({ ok: true, errors: [] }),
  executeReadOnly: () => ({ outputs: ["reports/n2/demo.json"], digest: "", summary: { n: 1 } }),
  pitGuarantee: () => ({ pit: true, sameRaceLeakage: false, futureLeakage: false }),
  ...o,
});

test("unimplemented executor returns ENGINEERING_REQUIRED (no loop)", () => {
  const r = runExecutorLifecycle(okSpec({ implemented: false, engineeringNote: "needs odds table" }), ctx);
  assert.equal(r.result, "ENGINEERING_REQUIRED");
  assert.ok(r.blocks.includes("EXECUTOR_NOT_IMPLEMENTED"));
  assert.equal((r.summary as any).engineeringNote, "needs odds table");
});

test("happy path passes full lifecycle", () => {
  const r = runExecutorLifecycle(okSpec(), ctx);
  assert.equal(r.result, "PASS");
  assert.deepEqual(r.lifecycle, ["prepare", "validateInputs", "executeReadOnly", "writeArtifact", "verifyArtifact", "recordEvidence", "transitionState"]);
  assert.ok(r.digest.length === 64);
});

test("write-scope violation is blocked", () => {
  const r = runExecutorLifecycle(okSpec({ executeReadOnly: () => ({ outputs: ["src/domain/decision.ts"], digest: "", summary: {} }) }), ctx);
  assert.equal(r.result, "BLOCKED");
  assert.ok(r.blocks.includes("WRITE_SCOPE_VIOLATION"));
});

test("PIT/leakage violation is blocked", () => {
  const r = runExecutorLifecycle(okSpec({ pitGuarantee: () => ({ pit: true, sameRaceLeakage: true, futureLeakage: false }) }), ctx);
  assert.equal(r.result, "BLOCKED");
  assert.ok(r.blocks.includes("PIT_OR_LEAKAGE_VIOLATION"));
});

test("secret in artifact is blocked", () => {
  const r = runExecutorLifecycle(okSpec({ executeReadOnly: () => ({ outputs: ["reports/n2/x.json"], digest: "", summary: { token: "ghp_" + "a".repeat(30) } }) }), ctx);
  assert.equal(r.result, "BLOCKED");
  assert.ok(r.blocks.includes("SECRET_IN_ARTIFACT"));
});

test("input contract failure is blocked", () => {
  const r = runExecutorLifecycle(okSpec({ inputContract: () => ({ ok: false, errors: ["missing dataset"] }) }), ctx);
  assert.equal(r.result, "BLOCKED");
  assert.ok(r.blocks.includes("INPUT_CONTRACT"));
});

test("pure guards", () => {
  assert.equal(checkWriteScope(["reports/n2/a.json"], ["reports/n2/"]).ok, true);
  assert.equal(checkWriteScope(["../etc/passwd"], ["reports/n2/"]).ok, false);
  assert.equal(checkNoSecrets("nothing here").ok, true);
  assert.equal(checkNoSecrets("ghp_" + "b".repeat(30)).ok, false);
  assert.equal(checkProductionIsolation("read-only research config").ok, true);
  assert.equal(checkProductionIsolation("connects to app_settings and auto_vote").ok, false);
  assert.equal(idempotencyKey({ a: 1, b: "x" }), idempotencyKey({ b: "x", a: 1 }));
});

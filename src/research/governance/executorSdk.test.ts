import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  atomicWriteJson, checkNoSecrets, checkProductionIsolation, checkWriteScope, idempotencyKey,
  runExecutorLifecycle, verifyJsonReadback, type ExecutorSpec, type SdkContext,
} from "./executorSdk";

function makeCtx(dryRun = false): SdkContext {
  const root = mkdtempSync(join(tmpdir(), "sdk-"));
  return { repoRoot: root, runId: "r1", taskId: "TASK-T", dataRoot: root, dryRun, writeAllowlist: ["reports/n2/"] };
}

const okSpec = (o: Partial<ExecutorSpec> = {}): ExecutorSpec => ({
  name: "demo",
  safetyLevel: "L0",
  implemented: true,
  inputContract: () => ({ ok: true, errors: [] }),
  executeReadOnly: () => ({ outputs: ["reports/n2/demo.json"], digest: "d".repeat(64), summary: { n: 1 } }),
  pitEvidence: () => ({
    status: "PASS", validatorId: "demo-pit", validatorVersion: "v1", checkedRecordCount: 1,
    sameRaceViolationCount: 0, futureViolationCount: 0, ambiguousTimingCount: 0,
    evidencePath: "reports/n2/demo-pit.json", evidenceDigest: "e".repeat(64), notApplicableReason: null,
  }),
  writeArtifacts: (ctx, art) => {
    const rel = art.outputs[0];
    atomicWriteJson(join(ctx.repoRoot, rel), { ...art.summary, outputDigest: art.digest }, true);
    return { ok: true, errors: [], outputs: [rel] };
  },
  verifyArtifacts: (ctx, art, outputs) => verifyJsonReadback(join(ctx.repoRoot, outputs[0]), art.digest),
  recordEvidence: (_ctx, _art, outputs) => ({ ok: true, errors: [], outputs }),
  transitionState: (_ctx, _art, outputs) => ({ ok: true, errors: [], outputs }),
  ...o,
});

test("unimplemented executor returns ENGINEERING_REQUIRED", () => {
  const r = runExecutorLifecycle(okSpec({ implemented: false, engineeringNote: "needs odds table" }), makeCtx());
  assert.equal(r.result, "ENGINEERING_REQUIRED");
  assert.ok(r.blocks.includes("EXECUTOR_NOT_IMPLEMENTED"));
});

test("happy path passes only after write, readback, evidence, transition", () => {
  const ctx = makeCtx();
  const r = runExecutorLifecycle(okSpec(), ctx);
  assert.equal(r.result, "PASS");
  assert.deepEqual(r.lifecycle, [
    "prepare", "validateInputs", "executeReadOnly", "validatePitEvidence", "writeArtifacts",
    "verifyArtifactsByReadback", "recordEvidence", "transitionState",
  ]);
  assert.equal(existsSync(join(ctx.repoRoot, "reports/n2/demo.json")), true);
});

test("dry-run creates no file and does not claim write stages", () => {
  const ctx = makeCtx(true);
  const r = runExecutorLifecycle(okSpec(), ctx);
  assert.equal(r.result, "PASS");
  assert.deepEqual(r.lifecycle, ["prepare", "validateInputs", "executeReadOnly", "validatePitEvidence", "dryRunComplete"]);
  assert.equal(existsSync(join(ctx.repoRoot, "reports/n2/demo.json")), false);
  assert.deepEqual(r.outputs, []);
});

test("non-dry executor without lifecycle callbacks is blocked", () => {
  const r = runExecutorLifecycle(okSpec({ writeArtifacts: undefined }), makeCtx());
  assert.equal(r.result, "BLOCKED");
  assert.ok(r.blocks.includes("INCOMPLETE_EXECUTOR_LIFECYCLE_CALLBACKS"));
});

test("write failure cannot return PASS", () => {
  const r = runExecutorLifecycle(okSpec({ writeArtifacts: () => ({ ok: false, errors: ["disk full"] }) }), makeCtx());
  assert.equal(r.result, "FAILED");
  assert.ok(r.blocks.includes("ARTIFACT_WRITE_FAILED"));
});

test("missing or mismatched artifact cannot return PASS", () => {
  const missing = runExecutorLifecycle(okSpec({
    writeArtifacts: (_ctx, art) => ({ ok: true, errors: [], outputs: art.outputs }),
  }), makeCtx());
  assert.equal(missing.result, "FAILED");
  assert.ok(missing.blocks.includes("ARTIFACT_VERIFY_FAILED"));

  const mismatch = runExecutorLifecycle(okSpec({
    writeArtifacts: (ctx, art) => {
      atomicWriteJson(join(ctx.repoRoot, art.outputs[0]), { outputDigest: "wrong" }, true);
      return { ok: true, errors: [], outputs: art.outputs };
    },
  }), makeCtx());
  assert.equal(mismatch.result, "FAILED");
});

test("evidence and state transition failures cannot return PASS", () => {
  const evidence = runExecutorLifecycle(okSpec({ recordEvidence: () => ({ ok: false, errors: ["registry conflict"] }) }), makeCtx());
  assert.equal(evidence.result, "FAILED");
  assert.ok(evidence.blocks.includes("EVIDENCE_RECORD_FAILED"));

  const state = runExecutorLifecycle(okSpec({ transitionState: () => ({ ok: false, errors: ["CAS conflict"] }) }), makeCtx());
  assert.equal(state.result, "FAILED");
  assert.ok(state.blocks.includes("STATE_TRANSITION_FAILED"));
});

test("PIT evidence is required and violations are blocked", () => {
  const missing = runExecutorLifecycle(okSpec({ pitEvidence: undefined, pitGuarantee: undefined }), makeCtx());
  assert.equal(missing.result, "BLOCKED");
  assert.ok(missing.blocks.includes("PIT_EVIDENCE_MISSING_OR_INVALID"));

  const violation = runExecutorLifecycle(okSpec({
    pitEvidence: () => ({
      status: "PASS", validatorId: "x", validatorVersion: "v1", checkedRecordCount: 1,
      sameRaceViolationCount: 1, futureViolationCount: 0, ambiguousTimingCount: 0,
      evidencePath: "x", evidenceDigest: "e", notApplicableReason: null,
    }),
  }), makeCtx());
  assert.equal(violation.result, "BLOCKED");
  assert.ok(violation.blocks.includes("PIT_OR_LEAKAGE_VIOLATION"));
});

test("atomic JSON write leaves parseable final artifact", () => {
  const root = mkdtempSync(join(tmpdir(), "atomic-"));
  const path = join(root, "a.json");
  atomicWriteJson(path, { a: 1 });
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { a: 1 });
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

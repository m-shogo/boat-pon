import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyDisk, classifyFailureAction, computeVerdict, failureSignature, readinessDigest,
  shouldStopAutoRetry, type ReadinessCheck,
} from "./readiness";

const GB = 1024 ** 3;

test("disk classifier: ok / warning / critical tiers (#13/#14)", () => {
  assert.equal(classifyDisk(403 * GB, 926 * GB).level, "ok"); // 43.5% free
  // warning band: on a 100GB disk, 18GB free = 18% ... use 14GB (14%, <15% warn, >8% crit, <20GB bytes)
  const warn = classifyDisk(14 * GB, 100 * GB);
  assert.equal(warn.level, "warning");
  assert.equal(warn.startAllowed, true);
  // critical by bytes (<10GB) regardless of ratio
  const crit = classifyDisk(9 * GB, 926 * GB);
  assert.equal(crit.level, "critical");
  assert.equal(crit.startAllowed, false); // critical → executor 開始禁止
  // critical by ratio (<8%) even when bytes look large
  assert.equal(classifyDisk(18 * GB, 926 * GB).level, "critical"); // 1.9% ratio
  // ratio-based: 50/1000 = 5% < critical ratio 8% → critical (bytes 50GB alone would be ok)
  assert.equal(classifyDisk(50 * GB, 1000 * GB).level, "critical");
  // ratio warning band: 120/1000 = 12% (< 15% warn, > 8% crit) with tiny byte floors → warning
  assert.equal(classifyDisk(120 * GB, 1000 * GB, { warningFreeBytes: 0, warningFreeRatio: 0.15, criticalFreeBytes: 0, criticalFreeRatio: 0.08 }).level, "warning");
});

test("failure signature is stable and order-insensitive", () => {
  assert.equal(failureSignature("TASK-A", ["X", "Y"]), failureSignature("TASK-A", ["Y", "X"]));
  assert.notEqual(failureSignature("TASK-A", ["X"]), failureSignature("TASK-B", ["X"]));
});

test("auto-retry stops after 2 consecutive same task+signature (#11/#12)", () => {
  const sig = "s1";
  assert.equal(shouldStopAutoRetry([], "TASK-A", sig), false); // 1st
  assert.equal(shouldStopAutoRetry([{ taskId: "TASK-A", signature: sig }], "TASK-A", sig), true); // 2nd consecutive → stop
  // different signature in between resets
  assert.equal(shouldStopAutoRetry([{ taskId: "TASK-A", signature: "other" }], "TASK-A", sig), false);
});

test("failure action classification (data contract / PIT / disk / authority / transient / executor)", () => {
  assert.equal(classifyFailureAction("EXECUTOR_NOT_IMPLEMENTED"), "ENGINEERING_REQUIRED");
  assert.equal(classifyFailureAction("DATASET_CONTRACT_VIOLATION"), "ENGINEERING_REQUIRED");
  assert.equal(classifyFailureAction("PIT_OR_LEAKAGE_VIOLATION"), "BLOCKED_TERMINAL");
  assert.equal(classifyFailureAction("INSUFFICIENT_DISK"), "BLOCKED_RESOURCE");
  assert.equal(classifyFailureAction("AUTHORITY_SHA_MISMATCH"), "WAIT_NEW_INTENT");
  assert.equal(classifyFailureAction("NETWORK_TIMEOUT"), "RETRY_BACKOFF");
  assert.equal(classifyFailureAction("SOME_OTHER"), "NO_RETRY");
});

const chk = (name: string, status: ReadinessCheck["status"], severity: ReadinessCheck["severity"] = "P0"): ReadinessCheck => ({ name, status, severity });

test("verdict: PASS only when all PASS (#28)", () => {
  const v = computeVerdict([chk("a", "PASS"), chk("b", "PASS")]);
  assert.equal(v.verdict, "PASS");
  assert.deepEqual(v.unresolvedBlockers, []);
});

test("verdict: CONDITIONAL when any conditional / not-run (#29)", () => {
  assert.equal(computeVerdict([chk("a", "PASS"), chk("b", "CONDITIONAL", "P2")]).verdict, "CONDITIONAL");
  assert.equal(computeVerdict([chk("a", "PASS"), chk("b", "NOT_RUN")]).verdict, "CONDITIONAL"); // 未実行は PASS にしない
  assert.equal(computeVerdict([chk("a", "PASS"), chk("b", "BLOCKED", "P2")]).verdict, "CONDITIONAL"); // P2 blocked → conditional
});

test("verdict: BLOCKED when any P0/P1 blocked (#30)", () => {
  const v = computeVerdict([chk("a", "PASS"), chk("b", "BLOCKED", "P0")]);
  assert.equal(v.verdict, "BLOCKED");
  assert.equal(v.unresolvedBlockers.length, 1);
  assert.equal(computeVerdict([chk("a", "BLOCKED", "P1")]).verdict, "BLOCKED");
});

test("readiness digest stable regardless of key order", () => {
  assert.equal(readinessDigest({ a: 1, b: 2 }), readinessDigest({ b: 2, a: 1 }));
});

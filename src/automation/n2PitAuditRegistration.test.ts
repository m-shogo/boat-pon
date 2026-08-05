import assert from "node:assert/strict";
import test from "node:test";
import {
  EXECUTOR_REGISTRY_VERSION,
  isExecutorImplemented,
  resolveExecutor,
} from "./taskExecutors";
import { runN2PitAuditExecutor } from "./n2PitAuditExecutor";

test("N2-011 PIT audit is registered only through the allowlisted resolver", () => {
  assert.equal(EXECUTOR_REGISTRY_VERSION, "n2-task-executor-registry-v3");
  assert.equal(isExecutorImplemented("pit-audit"), true);
  assert.equal(resolveExecutor("pit-audit").code, "OK");
  assert.equal(resolveExecutor("pit-audit").executor, runN2PitAuditExecutor);
});

test("registry remains fail-closed for arbitrary task types", () => {
  assert.equal(isExecutorImplemented("pit-audit; rm -rf /"), false);
  assert.equal(resolveExecutor("__proto__").code, "EXECUTOR_NOT_REGISTERED");
});

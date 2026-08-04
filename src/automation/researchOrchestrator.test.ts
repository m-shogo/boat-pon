import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUEST_SCHEMA_VERSION, canTransition, checkChangedPaths, classifyFailure, computeRequestDigest,
  decideSafety, isPathAllowed, preflight, validateRequest,
} from "./researchOrchestrator";

const POLICY = { allowedSafetyLevels: ["L0", "L1", "L2"], deniedSafetyLevels: ["L3", "L4"] };

function baseRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const req: Record<string, unknown> = {
    requestSchemaVersion: REQUEST_SCHEMA_VERSION,
    requestId: "REQ-0001",
    taskId: "TASK-N2-001",
    requestedAction: "run-task",
    safetyLevel: "L0",
    authoritySha: "ac4b34f",
    queueDigest: "a".repeat(64),
    createdAt: "2026-08-03T00:00:00.000Z",
    requestedBy: "chatgpt-scheduled-task",
    maxDurationSeconds: 1800,
    expectedOutput: "reports/automation/history/run.json",
    approvalRequirement: "none",
    ...overrides,
  };
  req.requestDigest = computeRequestDigest(req);
  return req;
}

test("valid request passes strict validation", () => {
  const r = validateRequest(baseRequest());
  assert.deepEqual(r.errors, []);
  assert.equal(r.valid, true);
  assert.equal(r.request?.taskId, "TASK-N2-001");
});

test("unknown field is rejected", () => {
  const r = validateRequest(baseRequest({ sneaky: "x" }));
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("unknown field: sneaky")));
});

test("missing field is rejected", () => {
  const req = baseRequest();
  delete req.expectedOutput;
  const r = validateRequest(req);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("missing field: expectedOutput")));
});

test("tampered request (digest mismatch) is rejected", () => {
  const req = baseRequest();
  req.safetyLevel = "L2"; // digest を作り直さずに改変
  const r = validateRequest(req);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("requestDigest mismatch")));
});

test("invalid safety level / action / sha are rejected", () => {
  assert.equal(validateRequest(baseRequest({ safetyLevel: "L9" })).valid, false);
  assert.equal(validateRequest(baseRequest({ requestedAction: "rm-rf" })).valid, false);
  assert.equal(validateRequest(baseRequest({ authoritySha: "ZZZZ" })).valid, false);
  assert.equal(validateRequest(baseRequest({ requestId: "hack; rm -rf /" })).valid, false);
});

test("L4 request is always forbidden", () => {
  const d = decideSafety("L4", POLICY, { present: true, valid: true });
  assert.equal(d.allowed, false);
  assert.equal(d.code, "L4_FORBIDDEN");
  assert.equal(d.exitCode, 3);
});

test("L3 requires an existing valid grant (exit 3 without)", () => {
  const without = decideSafety("L3", POLICY, { present: false, valid: false });
  assert.equal(without.allowed, false);
  assert.equal(without.code, "L3_REQUIRES_GRANT");
  assert.equal(without.exitCode, 3);
  const withGrant = decideSafety("L3", POLICY, { present: true, valid: true });
  assert.equal(withGrant.allowed, true);
});

test("L0/L1/L2 allowed by policy", () => {
  for (const l of ["L0", "L1", "L2"] as const) assert.equal(decideSafety(l, POLICY).allowed, true);
});

function pf(overrides: Partial<Parameters<typeof preflight>[0]> = {}) {
  return preflight({
    emergencyStop: false, paused: false, workingTreeClean: true,
    localHeadSha: "ac4b34f8ec063a70352d77c6a53cdc9fe5891d61", originHeadSha: "ac4b34f8ec063a70352d77c6a53cdc9fe5891d61",
    activeWal: false, freeDiskBytes: 400e9, minFreeDiskBytes: 20e9,
    queueDigest: "b".repeat(64), requestQueueDigest: "b".repeat(64),
    authoritySha: "ac4b34f", alreadyProcessedRequestIds: [], requestId: "REQ-0001", ...overrides,
  });
}

test("preflight passes on a clean, quiescent, in-sync repo", () => {
  const r = pf();
  assert.deepEqual(r.blocks, []);
  assert.equal(r.ok, true);
});

test("preflight blocks emergency stop / pause / dirty tree / drift / WAL / disk / queue / replay", () => {
  assert.ok(pf({ emergencyStop: true }).blocks.includes("EMERGENCY_STOP_ACTIVE"));
  assert.ok(pf({ paused: true }).blocks.includes("AUTOMATION_PAUSED"));
  assert.ok(pf({ workingTreeClean: false }).blocks.includes("DIRTY_WORKING_TREE"));
  assert.ok(pf({ originHeadSha: "deadbeef" }).blocks.includes("GIT_DRIFT_LOCAL_VS_ORIGIN"));
  assert.ok(pf({ authoritySha: "0000000" }).blocks.includes("AUTHORITY_SHA_MISMATCH"));
  assert.ok(pf({ activeWal: true }).blocks.includes("ACTIVE_WAL"));
  assert.ok(pf({ freeDiskBytes: 1 }).blocks.includes("INSUFFICIENT_DISK"));
  assert.ok(pf({ requestQueueDigest: "c".repeat(64) }).blocks.includes("QUEUE_DIGEST_MISMATCH"));
  assert.ok(pf({ alreadyProcessedRequestIds: ["REQ-0001"] }).blocks.includes("REQUEST_REPLAY"));
});

test("authority SHA accepts HEAD or its parent (request commit advances main)", () => {
  const head = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const parent = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  // HEAD 一致
  assert.deepEqual(pf({ localHeadSha: head, originHeadSha: head, parentShas: [parent], authoritySha: head.slice(0,7) }).blocks, []);
  // parent 一致（request を commit して main が 1 つ進んだ正当ケース）
  assert.deepEqual(pf({ localHeadSha: head, originHeadSha: head, parentShas: [parent], authoritySha: parent.slice(0,7) }).blocks, []);
  // それより古い authority は BLOCK
  assert.ok(pf({ localHeadSha: head, originHeadSha: head, parentShas: [parent], authoritySha: "cccccccc".slice(0,7) }).blocks.includes("AUTHORITY_SHA_MISMATCH"));
});

test("task status transitions are constrained", () => {
  assert.equal(canTransition("READY", "CLAIMED"), true);
  assert.equal(canTransition("CLAIMED", "RUNNING"), true);
  assert.equal(canTransition("RUNNING", "PASS"), true);
  assert.equal(canTransition("PASS", "RUNNING"), false);
  assert.equal(canTransition("FAILED_FINAL", "READY"), false);
  assert.equal(canTransition("READY", "PASS"), false);
});

test("failure classification separates retryable from non-retryable", () => {
  assert.equal(classifyFailure("L4_FORBIDDEN"), "NON_RETRYABLE");
  assert.equal(classifyFailure("REQUEST_REPLAY"), "NON_RETRYABLE");
  assert.equal(classifyFailure("AUTHORITY_SHA_MISMATCH"), "NON_RETRYABLE");
  assert.equal(classifyFailure("NETWORK_TIMEOUT"), "RETRYABLE");
});

test("git path allowlist rejects traversal, absolute, and unrelated paths", () => {
  const allow = ["automation/", "reports/automation/"];
  assert.equal(isPathAllowed("automation/task-queue.json", allow), true);
  assert.equal(isPathAllowed("reports/automation/current-status.json", allow), true);
  assert.equal(isPathAllowed("../../etc/passwd", allow), false);
  assert.equal(isPathAllowed("automation/../../secret", allow), false);
  assert.equal(isPathAllowed("/etc/passwd", allow), false);
  assert.equal(isPathAllowed("src/domain/decision.ts", allow), false);
  assert.equal(isPathAllowed("data/research-replay.sqlite", allow), false);
  const checked = checkChangedPaths(["automation/x.json", "src/prod.ts"], allow);
  assert.equal(checked.ok, false);
  assert.deepEqual(checked.rejected, ["src/prod.ts"]);
});

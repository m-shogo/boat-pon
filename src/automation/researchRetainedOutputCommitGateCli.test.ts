import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(process.cwd());
const gateCli = resolve(repoRoot, "scripts/check-research-retained-output-commit.mjs");
const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const taskId = "TASK-N2-011";
const outputDigest = "a".repeat(64);
const idempotencyKey = "b".repeat(64);
const authoritySha = "c".repeat(40);
assert.ok(trustedGitBin.startsWith("/"), "test runtime must resolve git to an absolute path");

function terminalHistory(runId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId,
    requestId: "REQ-test",
    intentId: "INTENT-test",
    taskId,
    taskType: "pit-audit",
    safetyLevel: "L0",
    executorVersion: "test-executor-v1",
    outputs: [],
    result: "PASS",
    blocks: [],
    executed: true,
    outputDigest,
    summary: {},
    idempotencyKey,
    authoritySha,
    startedAt: "2026-08-12T00:00:00.000Z",
    completedAt: "2026-08-12T00:00:01.000Z",
    elapsedMs: 1000,
    ...overrides,
  };
}

function withRepo(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-commit-gate-"));
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function put(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function runGate(
  root: string,
  runId: string,
  github: { actions?: boolean; runId?: string } = {},
): string {
  return execFileSync(process.execPath, [gateCli, `--run-id=${runId}`], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      TRUSTED_GIT_BIN: trustedGitBin,
      GITHUB_ACTIONS: github.actions ? "true" : "false",
      GITHUB_RUN_ID: github.runId ?? "",
    },
  });
}

test("CLI accepts an untracked retained output referenced by same-run terminal history", () => {
  withRepo((root) => {
    const runId = "12345";
    const content = "{}\n";
    const contentDigest = createHash("sha256").update(content).digest("hex");
    const output = `reports/automation/retained-outputs/${runId}/${contentDigest}-report.json`;
    const history = `reports/automation/history/${runId}-${taskId}.json`;
    put(root, output, content);
    put(root, history, `${JSON.stringify(terminalHistory(runId, { outputs: [output] }))}\n`);
    const value = JSON.parse(runGate(root, runId)) as Record<string, unknown>;
    assert.equal(value.retainedPathCount, 1);
    assert.equal(value.referencedRetainedPathCount, 1);
    assert.equal(value.currentBuyConnectionAuthorized, false);
    assert.equal(value.productionApplyAuthorized, false);
  });
});

test("CLI rejects retained outputs whose filename digest does not match their bytes", () => {
  withRepo((root) => {
    const runId = "12345";
    const output = `reports/automation/retained-outputs/${runId}/${"a".repeat(64)}-report.json`;
    const history = `reports/automation/history/${runId}-${taskId}.json`;
    put(root, output, "{}\n");
    put(root, history, `${JSON.stringify(terminalHistory(runId, { outputs: [output] }))}\n`);
    assert.throws(() => runGate(root, runId), /RETAINED_COMMIT_CONTENT_DIGEST_MISMATCH/u);
  });
});

test("CLI rejects missing or non-terminal history results", () => {
  withRepo((root) => {
    const runId = "12345";
    const history = `reports/automation/history/${runId}-${taskId}.json`;
    put(root, history, `${JSON.stringify(terminalHistory(runId, { result: undefined }))}\n`);
    assert.throws(() => runGate(root, runId), /RETAINED_COMMIT_HISTORY_RESULT_INVALID:.*:missing/u);
    put(root, history, `${JSON.stringify(terminalHistory(runId, { result: "RUNNING" }))}\n`);
    assert.throws(() => runGate(root, runId), /RETAINED_COMMIT_HISTORY_RESULT_INVALID:.*:RUNNING/u);
  });
});

test("CLI rejects oversized retained history before parsing", () => {
  withRepo((root) => {
    const runId = "12345";
    const history = `reports/automation/history/${runId}-${taskId}.json`;
    put(root, history, "{}\n");
    truncateSync(join(root, history), 8_000_001);
    assert.throws(() => runGate(root, runId), /RETAINED_COMMIT_HISTORY_JSON_INVALID/u);
  });
});

test("CLI binds trusted run ID to the GitHub Actions run context", () => {
  withRepo((root) => {
    const runId = "12345";
    const history = `reports/automation/history/${runId}-${taskId}.json`;
    put(root, history, `${JSON.stringify(terminalHistory(runId))}\n`);
    const value = JSON.parse(runGate(root, runId, { actions: true, runId })) as Record<string, unknown>;
    assert.equal(value.historyPathCount, 1);
    assert.throws(
      () => runGate(root, "77777", { actions: true, runId }),
      /RETAINED_COMMIT_GITHUB_RUN_ID_MISMATCH:77777!=12345/u,
    );
    assert.throws(
      () => runGate(root, "local", { actions: true, runId }),
      /RETAINED_COMMIT_GITHUB_RUN_ID_MISMATCH:local!=12345/u,
    );
  });
});

test("CLI fails closed when GitHub Actions run identity is missing or malformed", () => {
  withRepo((root) => {
    assert.throws(
      () => runGate(root, "12345", { actions: true, runId: "" }),
      /RETAINED_COMMIT_GITHUB_RUN_ID_INVALID/u,
    );
    assert.throws(
      () => runGate(root, "12345", { actions: true, runId: "not-numeric" }),
      /RETAINED_COMMIT_GITHUB_RUN_ID_INVALID/u,
    );
  });
});

test("CLI rejects cross-run retained output lineage", () => {
  withRepo((root) => {
    const runId = "12345";
    const output = `reports/automation/retained-outputs/${runId}/${"c".repeat(64)}-report.json`;
    const otherOutput = `reports/automation/retained-outputs/99999/${"d".repeat(64)}-report.json`;
    const history = `reports/automation/history/${runId}-${taskId}.json`;
    put(root, output, "{}\n");
    put(root, history, `${JSON.stringify(terminalHistory(runId, { outputs: [output, otherOutput] }))}\n`);
    assert.throws(() => runGate(root, runId), /RETAINED_COMMIT_CONTENT_DIGEST_MISMATCH/u);
  });
});

test("CLI rejects history-only cross-run retained output lineage", () => {
  withRepo((root) => {
    const historyRunId = "12345";
    const otherOutput = `reports/automation/retained-outputs/99999/${"e".repeat(64)}-report.json`;
    const history = `reports/automation/history/${historyRunId}-${taskId}.json`;
    put(root, history, `${JSON.stringify(terminalHistory(historyRunId, { outputs: [otherOutput] }))}\n`);
    assert.throws(() => runGate(root, "77777"), /RETAINED_COMMIT_HISTORY_RUN_ID_MISMATCH:12345!=77777/u);
  });
});

test("CLI rejects history-only evidence for another workflow run even without retained outputs", () => {
  withRepo((root) => {
    const historyRunId = "12345";
    const history = `reports/automation/history/${historyRunId}-${taskId}.json`;
    put(root, history, `${JSON.stringify(terminalHistory(historyRunId))}\n`);
    assert.throws(() => runGate(root, "77777"), /RETAINED_COMMIT_HISTORY_RUN_ID_MISMATCH:12345!=77777/u);
  });
});

test("CLI rejects two terminal histories from one workflow run", () => {
  withRepo((root) => {
    const runId = "12345";
    const firstTaskId = "TASK-N2-011";
    const secondTaskId = "TASK-N2-012";
    const first = `reports/automation/history/${runId}-${firstTaskId}.json`;
    const second = `reports/automation/history/${runId}-${secondTaskId}.json`;
    put(root, first, `${JSON.stringify(terminalHistory(runId, { taskId: firstTaskId }))}\n`);
    put(root, second, `${JSON.stringify(terminalHistory(runId, { taskId: secondTaskId }))}\n`);
    assert.throws(() => runGate(root, runId), /RETAINED_COMMIT_HISTORY_COUNT_INVALID:12345:2/u);
  });
});

test("CLI rejects a task identity mismatch in append-only history", () => {
  withRepo((root) => {
    const runId = "12345";
    const history = `reports/automation/history/${runId}-${taskId}.json`;
    put(root, history, `${JSON.stringify(terminalHistory(runId, { taskId: "TASK-N2-012" }))}\n`);
    assert.throws(() => runGate(root, runId), /RETAINED_COMMIT_HISTORY_TASK_ID_MISMATCH/u);
  });
});

test("CLI rejects an orphan retained output before git staging", () => {
  withRepo((root) => {
    const runId = "12345";
    const output = `reports/automation/retained-outputs/${runId}/${"b".repeat(64)}-report.json`;
    put(root, output, "{}\n");
    assert.throws(() => runGate(root, runId), /RETAINED_COMMIT_CONTENT_DIGEST_MISMATCH/u);
    const status = execFileSync(trustedGitBin, ["status", "--porcelain", "-uall"], { cwd: root, encoding: "utf8" });
    assert.match(status, /reports\/automation\/retained-outputs\/12345/u);
  });
});

test("CLI ignores unrelated automation changes when no retained output exists", () => {
  withRepo((root) => {
    put(root, "reports/automation/current-status.json", "{}\n");
    const value = JSON.parse(runGate(root, "12345")) as Record<string, unknown>;
    assert.equal(value.retainedPathCount, 0);
  });
});
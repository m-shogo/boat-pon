import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(process.cwd());
const gateCli = resolve(repoRoot, "scripts/check-research-retained-output-commit.mjs");
const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
assert.ok(trustedGitBin.startsWith("/"), "test runtime must resolve git to an absolute path");

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

function runGate(root: string, runId: string): string {
  return execFileSync(process.execPath, [gateCli, `--run-id=${runId}`], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, TRUSTED_GIT_BIN: trustedGitBin },
  });
}

test("CLI accepts an untracked retained output referenced by same-run history", () => {
  withRepo((root) => {
    const runId = "12345";
    const output = `reports/automation/retained-outputs/${runId}/${"a".repeat(64)}-report.json`;
    const history = `reports/automation/history/${runId}-TASK-N2-011.json`;
    put(root, output, "{}\n");
    put(root, history, `${JSON.stringify({ runId, outputs: [output] })}\n`);
    const value = JSON.parse(runGate(root, runId)) as Record<string, unknown>;
    assert.equal(value.retainedPathCount, 1);
    assert.equal(value.referencedRetainedPathCount, 1);
    assert.equal(value.currentBuyConnectionAuthorized, false);
    assert.equal(value.productionApplyAuthorized, false);
  });
});

test("CLI rejects cross-run retained output lineage", () => {
  withRepo((root) => {
    const runId = "12345";
    const output = `reports/automation/retained-outputs/${runId}/${"c".repeat(64)}-report.json`;
    const otherOutput = `reports/automation/retained-outputs/99999/${"d".repeat(64)}-report.json`;
    const history = `reports/automation/history/${runId}-TASK-N2-011.json`;
    put(root, output, "{}\n");
    put(root, history, `${JSON.stringify({ runId, outputs: [output, otherOutput] })}\n`);
    assert.throws(() => runGate(root, runId), /RETAINED_COMMIT_HISTORY_RETAINED_RUN_ID_MISMATCH/u);
  });
});

test("CLI rejects history-only cross-run retained output lineage", () => {
  withRepo((root) => {
    const historyRunId = "12345";
    const otherOutput = `reports/automation/retained-outputs/99999/${"e".repeat(64)}-report.json`;
    const history = `reports/automation/history/${historyRunId}-TASK-N2-011.json`;
    put(root, history, `${JSON.stringify({ runId: historyRunId, outputs: [otherOutput] })}\n`);
    assert.throws(() => runGate(root, "77777"), /RETAINED_COMMIT_HISTORY_RUN_ID_MISMATCH:12345!=77777/u);
  });
});

test("CLI rejects history-only evidence for another workflow run even without retained outputs", () => {
  withRepo((root) => {
    const historyRunId = "12345";
    const history = `reports/automation/history/${historyRunId}-TASK-N2-011.json`;
    put(root, history, `${JSON.stringify({ runId: historyRunId, outputs: [], result: "PASS" })}\n`);
    assert.throws(() => runGate(root, "77777"), /RETAINED_COMMIT_HISTORY_RUN_ID_MISMATCH:12345!=77777/u);
  });
});

test("CLI rejects two terminal histories from one workflow run", () => {
  withRepo((root) => {
    const runId = "12345";
    const first = `reports/automation/history/${runId}-TASK-N2-011.json`;
    const second = `reports/automation/history/${runId}-TASK-N2-012.json`;
    put(root, first, `${JSON.stringify({ runId, outputs: [], result: "PASS" })}\n`);
    put(root, second, `${JSON.stringify({ runId, outputs: [], result: "PASS" })}\n`);
    assert.throws(() => runGate(root, runId), /RETAINED_COMMIT_HISTORY_COUNT_INVALID:12345:2/u);
  });
});

test("CLI rejects an orphan retained output before git staging", () => {
  withRepo((root) => {
    const runId = "12345";
    const output = `reports/automation/retained-outputs/${runId}/${"b".repeat(64)}-report.json`;
    put(root, output, "{}\n");
    assert.throws(() => runGate(root, runId), /RETAINED_COMMIT_HISTORY_COUNT_INVALID/u);
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

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const RUN_ID = "12345";
const TASK_ID = "TASK-N2-011";
const MAX_SINGLE_BYTES = 2_097_152;
const HISTORY_PATH = `reports/automation/history/${RUN_ID}-${TASK_ID}.json`;

function retainedPath(content: Buffer, suffix: string): string {
  const digest = createHash("sha256").update(content).digest("hex");
  return `reports/automation/retained-outputs/${RUN_ID}/${digest}-${suffix}`;
}

function writeHistory(root: string, outputs: string[]): void {
  const absolute = join(root, HISTORY_PATH);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify({
    runId: RUN_ID,
    requestId: "REQ-test",
    intentId: "INTENT-test",
    taskId: TASK_ID,
    taskType: "readonly-audit",
    safetyLevel: "L0",
    executorVersion: "test-executor-v1",
    result: "PASS",
    blocks: [],
    executed: true,
    outputDigest: "a".repeat(64),
    idempotencyKey: "b".repeat(64),
    authoritySha: "c".repeat(40),
    outputs,
    summary: {},
    startedAt: "2026-08-12T00:00:00.000Z",
    completedAt: "2026-08-12T00:00:01.000Z",
    elapsedMs: 1000,
  })}\n`, "utf8");
}

test("trusted CLI enforces the producer 8 MiB aggregate retained-output ceiling", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-total-"));
  const trustedGitBin = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const gateCli = resolve(process.cwd(), "scripts/check-research-retained-output-commit.mjs");
  try {
    execFileSync(trustedGitBin, ["init", "-q"], { cwd: root });

    const outputs: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const content = Buffer.alloc(MAX_SINGLE_BYTES, index + 1);
      const relative = retainedPath(content, `output-${index}.bin`);
      const absolute = join(root, relative);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
      outputs.push(relative);
    }
    writeHistory(root, outputs);

    const environment = {
      ...process.env,
      TRUSTED_GIT_BIN: trustedGitBin,
      GITHUB_ACTIONS: "false",
      GITHUB_RUN_ID: "",
    };

    assert.doesNotThrow(() => execFileSync(process.execPath, [gateCli, `--run-id=${RUN_ID}`], {
      cwd: root,
      encoding: "utf8",
      env: environment,
    }));

    const extraContent = Buffer.from("x");
    const extraRelative = retainedPath(extraContent, "overflow.bin");
    const extraAbsolute = join(root, extraRelative);
    mkdirSync(dirname(extraAbsolute), { recursive: true });
    writeFileSync(extraAbsolute, extraContent);
    outputs.push(extraRelative);
    writeHistory(root, outputs);

    assert.throws(
      () => execFileSync(process.execPath, [gateCli, `--run-id=${RUN_ID}`], {
        cwd: root,
        encoding: "utf8",
        env: environment,
      }),
      /RETAINED_COMMIT_TOTAL_BYTES_EXCEEDED:8388609>8388608/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

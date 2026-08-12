import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { retainExecutorOutputs } from "./researchRetainedOutputs";

const digest = "0".repeat(64);

function retainWithRunId(root: string, runId: string): void {
  retainExecutorOutputs({
    repoRoot: root,
    runId,
    outputPaths: [],
    historyOutputDigest: digest,
  });
}

test("retained output writer accepts durable-compatible numeric run ids", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-run-id-"));
  try {
    assert.doesNotThrow(() => retainWithRunId(root, "123456789"));
    assert.equal(existsSync(join(root, "reports/automation/retained-outputs")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("retained output writer rejects nonnumeric run ids before filesystem materialization", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-run-id-"));
  try {
    for (const runId of [".", "..", "local-123", "run_123", "123.456", "abc"] as const) {
      assert.throws(
        () => retainWithRunId(root, runId),
        /RETAINED_OUTPUT_RUN_ID_INVALID/u,
        runId,
      );
    }
    assert.equal(existsSync(join(root, "reports/automation/retained-outputs")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

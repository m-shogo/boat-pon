import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { retainExecutorOutputs } from "./researchRetainedOutputs";

test("retained output writer rejects dot-only run ids before filesystem materialization", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-run-id-"));
  try {
    for (const runId of [".", ".."]) {
      assert.throws(
        () => retainExecutorOutputs({
          repoRoot: root,
          runId,
          outputPaths: [],
          historyOutputDigest: "0".repeat(64),
        }),
        /RETAINED_OUTPUT_RUN_ID_INVALID/u,
      );
    }
    assert.equal(existsSync(join(root, "reports/automation/retained-outputs")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

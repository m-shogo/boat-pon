import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { retainExecutorOutputs } from "./researchRetainedOutputs";

const DIGEST = "a".repeat(64);

function withRepo(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-immutable-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("immutable passthrough output must exist as a regular readable source", () => {
  withRepo((root) => {
    mkdirSync(join(root, "research/registries"), { recursive: true });
    assert.throws(
      () => retainExecutorOutputs({
        repoRoot: root,
        runId: "run-1",
        outputPaths: ["research/registries/missing.json"],
        historyOutputDigest: DIGEST,
      }),
      /RETAINED_OUTPUT_SOURCE_MISSING:research\/registries\/missing\.json/,
    );
  });
});

test("existing immutable passthrough output is preserved without copying", () => {
  withRepo((root) => {
    const relativePath = "research/registries/example.json";
    mkdirSync(join(root, "research/registries"), { recursive: true });
    writeFileSync(join(root, relativePath), '{"ok":true}\n');

    const result = retainExecutorOutputs({
      repoRoot: root,
      runId: "run-2",
      outputPaths: [relativePath],
      historyOutputDigest: DIGEST,
    });

    assert.deepEqual(result.historyOutputs, [relativePath]);
    assert.deepEqual(result.retainedOutputs, []);
  });
});

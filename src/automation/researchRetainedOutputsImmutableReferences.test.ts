import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { retainExecutorOutputs } from "./researchRetainedOutputs";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "retained-immutable-reference-"));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function put(root: string, relativePath: string, content = "{}\n"): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function retain(root: string, outputPaths: string[]) {
  return retainExecutorOutputs({
    repoRoot: root,
    runId: "12345",
    outputPaths,
    historyOutputDigest: "0".repeat(64),
  });
}

test("immutable registry references must exist before entering terminal history", () => {
  withRoot((root) => {
    put(root, "research/registries/experiments/existing.json");
    assert.throws(
      () => retain(root, ["research/registries/experiments/missing.json"]),
      /RETAINED_OUTPUT_IMMUTABLE_MISSING/u,
    );
  });
});

test("immutable registry references reject final symlinks and hardlinks", () => {
  withRoot((root) => {
    const real = "research/registries/experiments/real.json";
    const symlink = "research/registries/experiments/symlink.json";
    const hardlink = "research/registries/experiments/hardlink.json";
    put(root, real);

    symlinkSync(join(root, real), join(root, symlink));
    assert.throws(
      () => retain(root, [symlink]),
      /RETAINED_OUTPUT_IMMUTABLE_FILE_TYPE_INVALID/u,
    );

    linkSync(join(root, real), join(root, hardlink));
    assert.throws(
      () => retain(root, [hardlink]),
      /RETAINED_OUTPUT_IMMUTABLE_FILE_TYPE_INVALID/u,
    );
  });
});

test("immutable registry references reject aliased parent directories", () => {
  withRoot((root) => {
    const outside = mkdtempSync(join(tmpdir(), "retained-immutable-outside-"));
    try {
      put(outside, "experiments/outside.json");
      mkdirSync(join(root, "research"), { recursive: true });
      symlinkSync(outside, join(root, "research/registries"), "dir");
      assert.throws(
        () => retain(root, ["research/registries/experiments/outside.json"]),
        /RETAINED_OUTPUT_SOURCE_PATH_ALIAS/u,
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("existing canonical registry references still pass through unchanged", () => {
  withRoot((root) => {
    const source = "research/registries/experiments/EXP-1.json";
    put(root, source, `${JSON.stringify({ _digest: "c".repeat(64) })}\n`);
    const result = retain(root, [source]);
    assert.deepEqual(result.historyOutputs, [source]);
    assert.deepEqual(result.retainedOutputs, []);
  });
});

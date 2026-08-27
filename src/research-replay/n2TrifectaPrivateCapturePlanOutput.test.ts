import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { assertN2TrifectaPrivateCapturePlanOutputSafe } from "./n2TrifectaPrivateCapturePlanOutput";

function withRoots(fn: (repoRoot: string, dataRoot: string, scratchRoot: string) => void): void {
  const repoRoot = mkdtempSync(join(tmpdir(), "private-plan-repo-"));
  const dataRoot = mkdtempSync(join(tmpdir(), "private-plan-data-"));
  const scratchRoot = mkdtempSync(join(tmpdir(), "private-plan-scratch-"));
  try {
    mkdirSync(join(dataRoot, "data"), { recursive: true });
    writeFileSync(join(dataRoot, "data/boat.sqlite"), "fixture", "utf8");
    fn(repoRoot, dataRoot, scratchRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}

test("private capture plan output allows validation output and external scratch", () => {
  withRoots((repoRoot, dataRoot, scratchRoot) => {
    const primaryDbPath = join(dataRoot, "data/boat.sqlite");
    assert.doesNotThrow(() => assertN2TrifectaPrivateCapturePlanOutputSafe({
      repoRoot,
      primaryDbPath,
      outputPath: join(repoRoot, "reports/automation/validation/private-plan.json"),
    }));
    assert.doesNotThrow(() => assertN2TrifectaPrivateCapturePlanOutputSafe({
      repoRoot,
      primaryDbPath,
      outputPath: join(scratchRoot, "private-plan.json"),
    }));
  });
});

test("private capture plan output rejects repository authority and source paths", () => {
  withRoots((repoRoot, dataRoot) => {
    const primaryDbPath = join(dataRoot, "data/boat.sqlite");
    for (const outputPath of [
      join(repoRoot, "config/private-plan.json"),
      join(repoRoot, "scripts/private-plan.json"),
      join(repoRoot, "automation/private-plan.json"),
      join(repoRoot, "reports/n2/private-plan.json"),
    ]) {
      assert.throws(
        () => assertN2TrifectaPrivateCapturePlanOutputSafe({ repoRoot, primaryDbPath, outputPath }),
        /N2_PRIVATE_CAPTURE_PLAN_OUTPUT_REPO_PATH_FORBIDDEN/u,
      );
    }
  });
});

test("private capture plan output rejects the canonical primary-data directory", () => {
  withRoots((repoRoot, dataRoot) => {
    const primaryDbPath = join(dataRoot, "data/boat.sqlite");
    for (const outputPath of [
      join(dataRoot, "data/plan.json"),
      join(dataRoot, "data/boat.sqlite-wal"),
      join(dataRoot, "data/research-replay.sqlite"),
    ]) {
      assert.throws(
        () => assertN2TrifectaPrivateCapturePlanOutputSafe({ repoRoot, primaryDbPath, outputPath }),
        /N2_PRIVATE_CAPTURE_PLAN_OUTPUT_DATA_PATH_FORBIDDEN/u,
      );
    }
  });
});

test("private capture plan output rejects path aliases into protected roots", () => {
  withRoots((repoRoot, dataRoot, scratchRoot) => {
    const primaryDbPath = join(dataRoot, "data/boat.sqlite");
    mkdirSync(join(repoRoot, "reports/automation/validation"), { recursive: true });
    symlinkSync(scratchRoot, join(repoRoot, "reports/automation/validation/alias"), "dir");
    assert.throws(
      () => assertN2TrifectaPrivateCapturePlanOutputSafe({
        repoRoot,
        primaryDbPath,
        outputPath: join(repoRoot, "reports/automation/validation/alias/private-plan.json"),
      }),
      /N2_PRIVATE_CAPTURE_PLAN_OUTPUT_REPO_PATH_FORBIDDEN/u,
    );

    symlinkSync(join(dataRoot, "data"), join(scratchRoot, "data-alias"), "dir");
    assert.throws(
      () => assertN2TrifectaPrivateCapturePlanOutputSafe({
        repoRoot,
        primaryDbPath,
        outputPath: join(scratchRoot, "data-alias/private-plan.json"),
      }),
      /N2_PRIVATE_CAPTURE_PLAN_OUTPUT_DATA_PATH_FORBIDDEN/u,
    );
  });
});

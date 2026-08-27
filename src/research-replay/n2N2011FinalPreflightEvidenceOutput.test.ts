import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { assertN2N2011FinalPreflightEvidenceOutputSafe } from "./n2N2011FinalPreflightEvidenceOutput";

function withRoots(fn: (root: string, canonicalRepo: string, scratchRoot: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "n2-011-runner-"));
  const canonicalRepo = mkdtempSync(join(tmpdir(), "n2-011-canonical-"));
  const scratchRoot = mkdtempSync(join(tmpdir(), "n2-011-scratch-"));
  try {
    mkdirSync(join(root, "reports/automation/validation"), { recursive: true });
    mkdirSync(join(canonicalRepo, "data"), { recursive: true });
    fn(root, canonicalRepo, scratchRoot);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(canonicalRepo, { recursive: true, force: true });
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}

function assertSafe(input: {
  root: string;
  canonicalRepo: string;
  evidencePath: string;
}): void {
  assertN2N2011FinalPreflightEvidenceOutputSafe({
    root: input.root,
    canonicalRepo: input.canonicalRepo,
    primaryDbPath: join(input.canonicalRepo, "data/boat.sqlite"),
    sidecarDbPath: join(input.canonicalRepo, "data/research-replay.sqlite"),
    evidencePath: input.evidencePath,
  });
}

test("n2-011 preflight evidence allows runner validation and external scratch paths", () => {
  withRoots((root, canonicalRepo, scratchRoot) => {
    assert.doesNotThrow(() => assertSafe({
      root,
      canonicalRepo,
      evidencePath: join(root, "reports/automation/validation/n2-011.json"),
    }));
    assert.doesNotThrow(() => assertSafe({
      root,
      canonicalRepo,
      evidencePath: join(scratchRoot, "n2-011.json"),
    }));
  });
});

test("n2-011 preflight evidence rejects runner repository authority and source paths", () => {
  withRoots((root, canonicalRepo) => {
    for (const evidencePath of [
      join(root, "scripts/preflight-n2-011-final-audit.ts"),
      join(root, "config/research-automation-policy.json"),
      join(root, "automation/control/task-queue-state.json"),
      join(root, "reports/n2/n2-pit-audit.json"),
      join(root, "reports/automation/validation-other/n2-011.json"),
    ]) {
      assert.throws(
        () => assertSafe({ root, canonicalRepo, evidencePath }),
        /N2_011_PREFLIGHT_EVIDENCE_REPO_PATH_FORBIDDEN/u,
      );
    }
  });
});

test("n2-011 preflight evidence rejects canonical repository and data paths", () => {
  withRoots((root, canonicalRepo) => {
    for (const evidencePath of [
      join(canonicalRepo, "scripts/preflight-n2-011-final-audit.ts"),
      join(canonicalRepo, "config/research-automation-policy.json"),
      join(canonicalRepo, "automation/control/task-queue-state.json"),
      join(canonicalRepo, "reports/n2/n2-pit-audit.json"),
    ]) {
      assert.throws(
        () => assertSafe({ root, canonicalRepo, evidencePath }),
        /N2_011_PREFLIGHT_EVIDENCE_CANONICAL_REPO_PATH_FORBIDDEN/u,
      );
    }
    for (const evidencePath of [
      join(canonicalRepo, "data/tmp/n2-011.json"),
      join(canonicalRepo, "data/archive.json"),
    ]) {
      assert.throws(
        () => assertSafe({ root, canonicalRepo, evidencePath }),
        /N2_011_PREFLIGHT_EVIDENCE_DATA_PATH_FORBIDDEN/u,
      );
    }
  });
});

test("n2-011 preflight evidence rejects canonical database paths", () => {
  withRoots((root, canonicalRepo) => {
    const primaryDbPath = join(canonicalRepo, "data/boat.sqlite");
    const sidecarDbPath = join(canonicalRepo, "data/research-replay.sqlite");
    for (const evidencePath of [
      primaryDbPath,
      `${primaryDbPath}-wal`,
      `${primaryDbPath}-shm`,
      sidecarDbPath,
      `${sidecarDbPath}-wal`,
      `${sidecarDbPath}-shm`,
    ]) {
      assert.throws(
        () => assertSafe({ root, canonicalRepo, evidencePath }),
        /N2_011_PREFLIGHT_EVIDENCE_DATABASE_PATH_FORBIDDEN/u,
      );
    }
  });
});

test("n2-011 preflight evidence rejects validation aliases outside the runner repository", () => {
  withRoots((root, canonicalRepo, scratchRoot) => {
    const validationDir = join(root, "reports/automation/validation");
    symlinkSync(scratchRoot, join(validationDir, "alias"), "dir");
    assert.throws(
      () => assertSafe({
        root,
        canonicalRepo,
        evidencePath: join(validationDir, "alias/n2-011.json"),
      }),
      /N2_011_PREFLIGHT_EVIDENCE_REPO_PATH_FORBIDDEN/u,
    );
  });
});

test("n2-011 preflight evidence rejects external aliases into runner or canonical authority", () => {
  withRoots((root, canonicalRepo, scratchRoot) => {
    mkdirSync(join(root, "config"), { recursive: true });
    symlinkSync(join(root, "config"), join(scratchRoot, "runner-alias"), "dir");
    assert.throws(
      () => assertSafe({
        root,
        canonicalRepo,
        evidencePath: join(scratchRoot, "runner-alias/n2-011.json"),
      }),
      /N2_011_PREFLIGHT_EVIDENCE_REPO_PATH_FORBIDDEN/u,
    );

    symlinkSync(join(canonicalRepo, "data"), join(scratchRoot, "data-alias"), "dir");
    assert.throws(
      () => assertSafe({
        root,
        canonicalRepo,
        evidencePath: join(scratchRoot, "data-alias/n2-011.json"),
      }),
      /N2_011_PREFLIGHT_EVIDENCE_DATA_PATH_FORBIDDEN/u,
    );
  });
});

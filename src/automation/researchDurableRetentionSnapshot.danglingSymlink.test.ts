import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  durableRetentionSnapshotRelativePath,
  persistResearchDurableRetentionSnapshot,
  type ResearchDurableRetentionSnapshot,
} from "./researchDurableRetentionSnapshot";

function minimalSnapshot(): ResearchDurableRetentionSnapshot {
  return {
    effectiveDateJst: "2026-08-08",
    evidenceDigest: "a".repeat(64),
  } as ResearchDurableRetentionSnapshot;
}

test("dangling final snapshot symlink is rejected instead of replaced", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retention-dangling-final-"));
  try {
    const snapshot = minimalSnapshot();
    const relativePath = durableRetentionSnapshotRelativePath(snapshot);
    const absolutePath = join(root, relativePath);
    const missingTarget = join(root, "missing-snapshot-target.json");
    mkdirSync(dirname(absolutePath), { recursive: true });
    symlinkSync(missingTarget, absolutePath);

    assert.throws(
      () => persistResearchDurableRetentionSnapshot({ repoRoot: root, snapshot }),
      /DURABLE_RETENTION_EXISTING_SNAPSHOT_INVALID/u,
    );
    assert.equal(lstatSync(absolutePath).isSymbolicLink(), true);
    assert.equal(existsSync(missingTarget), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dangling parent symlink is rejected before snapshot directories are created", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retention-dangling-parent-"));
  try {
    const snapshot = minimalSnapshot();
    const retentionDir = join(root, "reports/automation/retention");
    const missingTarget = join(root, "missing-retention-target");
    mkdirSync(dirname(retentionDir), { recursive: true });
    symlinkSync(missingTarget, retentionDir, "dir");

    assert.throws(
      () => persistResearchDurableRetentionSnapshot({ repoRoot: root, snapshot }),
      /DURABLE_RETENTION_PARENT_PATH_INVALID/u,
    );
    assert.equal(existsSync(missingTarget), false);
    assert.equal(lstatSync(retentionDir).isSymbolicLink(), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { buildResearchDurableKnowledgeCompletenessReport } from "./researchDurableKnowledgeCompleteness";
import {
  buildResearchDurableRetentionSnapshot,
  durableRetentionSnapshotRelativePath,
  persistResearchDurableRetentionSnapshot,
  type ResearchDurableRetentionSnapshot,
} from "./researchDurableRetentionSnapshot";

function minimalSnapshot(repoRoot: string): ResearchDurableRetentionSnapshot {
  return buildResearchDurableRetentionSnapshot({
    report: buildResearchDurableKnowledgeCompletenessReport({ repoRoot }),
    sourceStateSha: "d".repeat(40),
    mainAuthoritySha: "e".repeat(40),
    firstObservedAt: "2026-08-07T14:00:00.000Z",
  });
}

test("dangling final snapshot symlink is rejected instead of replaced", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retention-dangling-final-"));
  try {
    const snapshot = minimalSnapshot(root);
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
    const snapshot = minimalSnapshot(root);
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

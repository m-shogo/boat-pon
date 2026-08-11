import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  durableRetentionSnapshotRelativePath,
  persistResearchDurableRetentionSnapshot,
  type ResearchDurableRetentionSnapshot,
} from "./researchDurableRetentionSnapshot";

test("retention writer rejects snapshots larger than its reader ceiling before publication", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retention-size-limit-"));
  try {
    const snapshot = {
      effectiveDateJst: "2026-08-08",
      evidenceDigest: "a".repeat(64),
      payload: "x".repeat(2_000_001),
    } as unknown as ResearchDurableRetentionSnapshot;
    const relativePath = durableRetentionSnapshotRelativePath(snapshot);

    assert.throws(
      () => persistResearchDurableRetentionSnapshot({ repoRoot: root, snapshot }),
      /DURABLE_RETENTION_SNAPSHOT_TOO_LARGE/u,
    );
    assert.equal(existsSync(join(root, relativePath)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildResearchDurableKnowledgeCompletenessReport } from "./researchDurableKnowledgeCompleteness";
import {
  buildResearchDurableRetentionSnapshot,
  durableRetentionSnapshotRelativePath,
  persistResearchDurableRetentionSnapshot,
  type ResearchDurableRetentionSnapshot,
} from "./researchDurableRetentionSnapshot";

test("invalid retention snapshots are rejected before append-only publication", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retention-prepublish-"));
  try {
    const report = buildResearchDurableKnowledgeCompletenessReport({ repoRoot: root });
    const snapshot = buildResearchDurableRetentionSnapshot({
      report,
      sourceStateSha: "d".repeat(40),
      mainAuthoritySha: "e".repeat(40),
      firstObservedAt: "2026-08-07T14:00:00.000Z",
    });
    const invalid = {
      ...snapshot,
      snapshotDigest: "0".repeat(64),
    } as ResearchDurableRetentionSnapshot;
    const relativePath = durableRetentionSnapshotRelativePath(invalid);

    assert.throws(
      () => persistResearchDurableRetentionSnapshot({ repoRoot: root, snapshot: invalid }),
      /DURABLE_RETENTION_SNAPSHOT_SELF_DIGEST_INVALID/u,
    );
    assert.equal(existsSync(join(root, relativePath)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

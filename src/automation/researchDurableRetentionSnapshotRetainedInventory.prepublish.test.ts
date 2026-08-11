import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildResearchDurableKnowledgeCompletenessReportWithRetainedInventory } from "./researchDurableKnowledgeRetainedInventory";
import { durableRetentionSnapshotRelativePath } from "./researchDurableRetentionSnapshot";
import {
  buildResearchDurableRetentionSnapshotWithRetainedInventory,
  persistResearchDurableRetentionSnapshotWithRetainedInventory,
} from "./researchDurableRetentionSnapshotRetainedInventory";

test("invalid retained-inventory counts are rejected before snapshot publication", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retention-inventory-prepublish-"));
  try {
    const report = buildResearchDurableKnowledgeCompletenessReportWithRetainedInventory({ repoRoot: root });
    const invalidReport = {
      ...report,
      retainedOutputFileCount: -1,
    } as typeof report;
    const snapshot = buildResearchDurableRetentionSnapshotWithRetainedInventory({
      report: invalidReport,
      sourceStateSha: "d".repeat(40),
      mainAuthoritySha: "e".repeat(40),
      firstObservedAt: "2026-08-07T14:00:00.000Z",
    });
    const relativePath = durableRetentionSnapshotRelativePath(snapshot);

    assert.throws(
      () => persistResearchDurableRetentionSnapshotWithRetainedInventory({ repoRoot: root, snapshot }),
      /DURABLE_RETENTION_RETAINED_INVENTORY_COUNT_INVALID:retainedOutputFileCount/u,
    );
    assert.equal(existsSync(join(root, relativePath)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

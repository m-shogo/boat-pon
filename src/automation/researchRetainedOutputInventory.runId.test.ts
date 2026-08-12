import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { inventoryResearchRetainedOutputs } from "./researchRetainedOutputInventory";

test("retained inventory rejects non-numeric persisted run directories", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-inventory-run-id-"));
  try {
    const content = "fixture retained evidence\n";
    const digest = createHash("sha256").update(content).digest("hex");
    const relativePath = `reports/automation/retained-outputs/local-123/${digest}-report.txt`;
    const absolutePath = join(root, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");

    const inventory = inventoryResearchRetainedOutputs({ repoRoot: root });
    assert.equal(inventory.rootPresent, true);
    assert.equal(inventory.validFileCount, 0);
    assert.equal(inventory.invalidFileCount, 1);
    assert.equal(inventory.entries[0]?.relativePath, "reports/automation/retained-outputs/local-123");
    assert.equal(inventory.entries[0]?.runId, null);
    assert.deepEqual(inventory.entries[0]?.issues, ["RETAINED_INVENTORY_RUN_DIRECTORY_INVALID"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

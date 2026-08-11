import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inventoryResearchRetainedOutputs } from "./researchRetainedOutputInventory";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "retained-inventory-canonical-name-"));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

test("retained inventory rejects filenames the canonical writer cannot produce", () => {
  withRoot((root) => {
    const content = "canonical retained evidence\n";
    const digest = sha256(content);
    const runDir = join(root, "reports/automation/retained-outputs/12345");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, `${digest}-not canonical.json`), content, "utf8");

    const inventory = inventoryResearchRetainedOutputs({ repoRoot: root });
    assert.equal(inventory.validFileCount, 0);
    assert.equal(inventory.invalidFileCount, 1);
    assert.deepEqual(inventory.entries[0]?.issues, ["RETAINED_INVENTORY_FILENAME_INVALID"]);
  });
});

test("retained inventory rejects basename suffixes longer than the writer limit", () => {
  withRoot((root) => {
    const content = "bounded retained evidence\n";
    const digest = sha256(content);
    const runDir = join(root, "reports/automation/retained-outputs/12345");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, `${digest}-${"a".repeat(161)}`), content, "utf8");

    const inventory = inventoryResearchRetainedOutputs({ repoRoot: root });
    assert.equal(inventory.validFileCount, 0);
    assert.equal(inventory.invalidFileCount, 1);
    assert.deepEqual(inventory.entries[0]?.issues, ["RETAINED_INVENTORY_FILENAME_INVALID"]);
  });
});

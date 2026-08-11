import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { inventoryResearchRetainedOutputs } from "./researchRetainedOutputInventory";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-retained-inventory-"));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function put(root: string, relativePath: string, content: string): string {
  const digest = createHash("sha256").update(content).digest("hex");
  const path = join(root, relativePath.replace("<digest>", digest));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return path;
}

test("missing retained root produces a clean zero inventory", () => {
  withRoot((root) => {
    const inventory = inventoryResearchRetainedOutputs({ repoRoot: root });
    assert.equal(inventory.rootPresent, false);
    assert.equal(inventory.fileCount, 0);
    assert.equal(inventory.invalidFileCount, 0);
    assert.deepEqual(inventory.entries, []);
  });
});

test("valid content-addressed retained files verify their filename digest", () => {
  withRoot((root) => {
    const content = "fixture retained evidence\n";
    put(root, "reports/automation/retained-outputs/123/<digest>-report.txt", content);
    const inventory = inventoryResearchRetainedOutputs({ repoRoot: root });
    assert.equal(inventory.rootPresent, true);
    assert.equal(inventory.fileCount, 1);
    assert.equal(inventory.validFileCount, 1);
    assert.equal(inventory.invalidFileCount, 0);
    assert.equal(inventory.totalBytes, Buffer.byteLength(content));
    assert.equal(inventory.entries[0]?.valid, true);
    assert.deepEqual(inventory.entries[0]?.issues, []);
  });
});

test("tampered retained content fails filename digest verification", () => {
  withRoot((root) => {
    const expected = createHash("sha256").update("original\n").digest("hex");
    const path = join(root, `reports/automation/retained-outputs/123/${expected}-report.txt`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "tampered\n", "utf8");
    const inventory = inventoryResearchRetainedOutputs({ repoRoot: root });
    assert.equal(inventory.invalidFileCount, 1);
    assert.deepEqual(inventory.entries[0]?.issues, ["RETAINED_INVENTORY_CONTENT_DIGEST_MISMATCH"]);
  });
});

test("invalid run directory and filename are fail-closed", () => {
  withRoot((root) => {
    put(root, "reports/automation/retained-outputs/bad run/<digest>-report.txt", "one\n");
    put(root, "reports/automation/retained-outputs/123/not-content-addressed.txt", "two\n");
    const inventory = inventoryResearchRetainedOutputs({ repoRoot: root });
    assert.equal(inventory.invalidFileCount, 2);
    assert.ok(inventory.entries.some((entry) => entry.issues.includes("RETAINED_INVENTORY_RUN_DIRECTORY_INVALID")));
    assert.ok(inventory.entries.some((entry) => entry.issues.includes("RETAINED_INVENTORY_FILENAME_INVALID")));
  });
});

test("retained inventory rejects symlinked parent directories", () => {
  withRoot((root) => {
    const outsideAutomation = mkdtempSync(join(tmpdir(), "boat-pon-retained-parent-outside-"));
    try {
      const content = "outside retained evidence\n";
      const digest = createHash("sha256").update(content).digest("hex");
      const outsideRun = join(outsideAutomation, "retained-outputs/123");
      mkdirSync(outsideRun, { recursive: true });
      writeFileSync(join(outsideRun, `${digest}-report.txt`), content, "utf8");
      mkdirSync(join(root, "reports"), { recursive: true });
      symlinkSync(outsideAutomation, join(root, "reports/automation"));

      const inventory = inventoryResearchRetainedOutputs({ repoRoot: root });
      assert.equal(inventory.rootPresent, true);
      assert.equal(inventory.fileCount, 0);
      assert.equal(inventory.validFileCount, 0);
      assert.equal(inventory.invalidFileCount, 1);
      assert.deepEqual(inventory.entries[0]?.issues, ["RETAINED_INVENTORY_ROOT_PARENT_INVALID"]);
    } finally {
      rmSync(outsideAutomation, { recursive: true, force: true });
    }
  });
});

test("symlink retained evidence is never followed", () => {
  withRoot((root) => {
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "outside\n", "utf8");
    const runDir = join(root, "reports/automation/retained-outputs/123");
    mkdirSync(runDir, { recursive: true });
    const digest = createHash("sha256").update("outside\n").digest("hex");
    symlinkSync(outside, join(runDir, `${digest}-report.txt`));
    const inventory = inventoryResearchRetainedOutputs({ repoRoot: root });
    assert.equal(inventory.invalidFileCount, 1);
    assert.ok(inventory.entries[0]?.issues.includes("RETAINED_INVENTORY_FILE_TYPE_INVALID"));
    assert.equal(inventory.entries[0]?.contentDigest, null);
  });
});

test("hardlinked retained evidence is rejected before hashing", () => {
  withRoot((root) => {
    const content = "shared retained evidence\n";
    const outside = join(root, "outside.txt");
    writeFileSync(outside, content, "utf8");
    const runDir = join(root, "reports/automation/retained-outputs/123");
    mkdirSync(runDir, { recursive: true });
    const digest = createHash("sha256").update(content).digest("hex");
    linkSync(outside, join(runDir, `${digest}-report.txt`));
    const inventory = inventoryResearchRetainedOutputs({ repoRoot: root });
    assert.equal(inventory.invalidFileCount, 1);
    assert.ok(inventory.entries[0]?.issues.includes("RETAINED_INVENTORY_FILE_LINK_COUNT_INVALID"));
    assert.equal(inventory.entries[0]?.contentDigest, null);
  });
});

test("oversize retained file is rejected before hashing", () => {
  withRoot((root) => {
    const content = "x".repeat(2_097_153);
    put(root, "reports/automation/retained-outputs/123/<digest>-large.txt", content);
    const inventory = inventoryResearchRetainedOutputs({ repoRoot: root });
    assert.equal(inventory.invalidFileCount, 1);
    assert.ok(inventory.entries[0]?.issues.includes("RETAINED_INVENTORY_FILE_SIZE_INVALID"));
    assert.equal(inventory.entries[0]?.contentDigest, null);
  });
});

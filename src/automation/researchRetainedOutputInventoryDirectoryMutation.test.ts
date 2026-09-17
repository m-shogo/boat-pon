import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
  resolve(process.cwd(), "src/automation/researchRetainedOutputInventory.ts"),
  "utf8",
);

test("retained inventory rejects directory content mutation during pathname scans", () => {
  assert.match(source, /left\.nlink === right\.nlink/u);
  assert.match(source, /left\.size === right\.size/u);
  assert.match(source, /left\.mtimeMs === right\.mtimeMs/u);
  assert.match(source, /left\.ctimeMs === right\.ctimeMs/u);
  assert.match(source, /RETAINED_INVENTORY_RUN_DIRECTORY_CHANGED_DURING_SCAN/u);
  assert.match(source, /RETAINED_INVENTORY_ROOT_CHANGED_DURING_SCAN/u);
});

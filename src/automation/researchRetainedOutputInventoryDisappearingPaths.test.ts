import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
  resolve(process.cwd(), "src/automation/researchRetainedOutputInventory.ts"),
  "utf8",
);

test("retained inventory converts disappearing pathname entries into fail-closed inventory evidence", () => {
  assert.doesNotMatch(source, /const runStat = lstatSync\(runPath\)/u);
  assert.doesNotMatch(source, /const stat = lstatSync\(absolutePath\)/u);
  assert.match(source, /const runStat = lstatIfPresent\(runPath\)/u);
  assert.match(source, /if \(!runStat\)[\s\S]*RETAINED_INVENTORY_RUN_DIRECTORY_CHANGED_DURING_SCAN/u);
  assert.match(source, /const stat = lstatIfPresent\(absolutePath\)/u);
  assert.match(source, /if \(!stat\)[\s\S]*RETAINED_INVENTORY_FILE_CHANGED_DURING_READ/u);
});

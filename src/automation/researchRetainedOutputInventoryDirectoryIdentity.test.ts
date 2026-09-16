import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
  resolve(process.cwd(), "src/automation/researchRetainedOutputInventory.ts"),
  "utf8",
);

test("retained inventory revalidates directory identity after pathname-based scans", () => {
  assert.match(source, /function sameFilesystemIdentity\(/u);
  assert.match(source, /left\.dev === right\.dev/u);
  assert.match(source, /left\.ino === right\.ino/u);
  assert.match(source, /sameFilesystemIdentity\(runStat, lstatIfPresent\(runPath\)\)/u);
  assert.match(source, /RETAINED_INVENTORY_RUN_DIRECTORY_CHANGED_DURING_SCAN/u);
  assert.match(source, /sameFilesystemIdentity\(rootStat, lstatIfPresent\(rootPath\)\)/u);
  assert.match(source, /RETAINED_INVENTORY_ROOT_CHANGED_DURING_SCAN/u);
});

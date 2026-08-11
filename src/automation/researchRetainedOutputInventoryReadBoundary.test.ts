import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const inventory = readFileSync(
  resolve(process.cwd(), "src/automation/researchRetainedOutputInventory.ts"),
  "utf8",
);

test("retained inventory reads remain descriptor-bound and size-bounded", () => {
  const helperStart = inventory.indexOf("function readValidatedRetainedFile");
  const inventoryStart = inventory.indexOf("export function inventoryResearchRetainedOutputs", helperStart);
  assert.ok(helperStart >= 0);
  assert.ok(inventoryStart > helperStart);
  const helper = inventory.slice(helperStart, inventoryStart);

  assert.match(helper, /openSync\(path, fsConstants\.O_RDONLY \| fsConstants\.O_NOFOLLOW \| fsConstants\.O_NONBLOCK\)/u);
  assert.match(helper, /fstatSync\(fd\)/u);
  assert.match(helper, /stat\.size > MAX_RETAINED_FILE_BYTES/u);
  assert.match(helper, /readSync\(fd/u);
  assert.match(helper, /remainingWithSentinel/u);
  assert.match(helper, /totalBytes > expectedStat\.size/u);
  assert.match(helper, /totalBytes !== expectedStat\.size/u);
  assert.doesNotMatch(helper, /readFileSync\(fd\)/u);
});

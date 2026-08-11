import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
  resolve(process.cwd(), "src/automation/researchRetainedOutputs.ts"),
  "utf8",
);

test("mutable retained-source reads stay bound to the size observed on the opened descriptor", () => {
  const helperStart = source.indexOf("function readRetainedSourceBounded");
  const helperEnd = source.indexOf("function existingRetainedTargetMatches", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = source.slice(helperStart, helperEnd);

  assert.match(helper, /const stat = fstatSync\(fd\)/u);
  assert.match(helper, /const postReadStat = fstatSync\(fd\)/u);
  assert.match(helper, /postReadStat\.size !== stat\.size \|\| totalBytes !== stat\.size/u);
  assert.match(helper, /RETAINED_OUTPUT_SOURCE_CHANGED_DURING_READ/u);
});

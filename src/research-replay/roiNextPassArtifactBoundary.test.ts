import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/summarize-roi-next-pass.ts", "utf8");

test("ROI next-pass verifies both generated inputs before reading", () => {
  assert.match(source, /ROI_NEXT_PASS_SEARCH_INPUT_IDENTITY_INVALID/u);
  assert.match(source, /JSON\.parse\(readFileSync\(verifiedSearchPath, "utf8"\)\)/u);
  assert.match(source, /ROI_NEXT_PASS_HYPOTHESIS_INPUT_IDENTITY_INVALID/u);
  assert.match(source, /JSON\.parse\(readFileSync\(verifiedHypothesisPath, "utf8"\)\)/u);
});

test("ROI next-pass publishes output atomically through a verified temp file", () => {
  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(source, /fsyncSync\(fd\)/u);
  assert.match(source, /ROI_NEXT_PASS_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /renameSync\(verifiedTempPath, path\)/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT,/u);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/run-roi-search-suite.ts", "utf8");

test("ROI search suite publishes summary through an exclusive verified temp file", () => {
  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(source, /fsyncSync\(fd\)/u);
  assert.match(source, /ROI_SEARCH_SUITE_SUMMARY_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(/u);
  assert.match(source, /renameSync\(verifiedTempPath, path\)/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_SUMMARY/u);
  assert.doesNotMatch(source, /writeFileSync\("reports\/roi-search-suite-summary\.md"/u);
});

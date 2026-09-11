import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-roi-all-data-sweep.ts", "utf8");

test("ROI all-data sweep verifies every existing upstream report before read", () => {
  assert.match(source, /ROI_ALL_DATA_SWEEP_INPUT_IDENTITY_INVALID/u);
  assert.match(source, /const verifiedPath = assertCanonicalSingleLinkRegularFile\(path,/u);
  assert.match(source, /JSON\.parse\(readFileSync\(verifiedPath, "utf8"\)\)/u);
  assert.doesNotMatch(source, /JSON\.parse\(readFileSync\(`\$\{REPORT_DIR\}\/\$\{name\}`/u);
});

test("ROI all-data sweep publishes JSON and Markdown through verified atomic temp files", () => {
  assert.match(source, /ROI_ALL_DATA_SWEEP_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_ALL_DATA_SWEEP_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(source, /fsyncSync\(fd\)/u);
  assert.match(source, /renameSync\(verifiedTempPath, path\)/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD,/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON,/u);
});

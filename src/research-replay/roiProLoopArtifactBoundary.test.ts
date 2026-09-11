import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/run-roi-pro-loop.ts", "utf8");

test("ROI pro loop verifies generated inputs before parsing them", () => {
  assert.match(source, /ROI_PRO_LOOP_ALL_INPUT_IDENTITY_INVALID/u);
  assert.match(source, /ROI_PRO_LOOP_PERSONA_INPUT_IDENTITY_INVALID/u);
  assert.match(source, /const verifiedPath = assertCanonicalSingleLinkRegularFile\(path, errorCode\)/u);
  assert.match(source, /JSON\.parse\(readFileSync\(verifiedPath, "utf8"\)\)/u);
  assert.doesNotMatch(source, /JSON\.parse\(readFileSync\(ALL_JSON/u);
  assert.doesNotMatch(source, /JSON\.parse\(readFileSync\(PERSONA_JSON/u);
});

test("ROI pro loop verifies archive sources and publishes archives atomically", () => {
  assert.match(source, /ROI_PRO_LOOP_ALL_SOURCE_IDENTITY_INVALID/u);
  assert.match(source, /ROI_PRO_LOOP_PERSONA_SOURCE_IDENTITY_INVALID/u);
  assert.match(source, /const verifiedSourcePath = assertCanonicalSingleLinkRegularFile\(sourcePath, sourceErrorCode\)/u);
  assert.match(source, /atomicPublish\(destinationPath, readFileSync\(verifiedSourcePath\), tempErrorCode\)/u);
  assert.doesNotMatch(source, /copyFileSync/u);
});

test("ROI pro loop publishes final JSON and Markdown through verified atomic temp files", () => {
  assert.match(source, /ROI_PRO_LOOP_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_PRO_LOOP_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(source, /fsyncSync\(fd\)/u);
  assert.match(source, /renameSync\(verifiedTempPath, path\)/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON,/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD,/u);
});

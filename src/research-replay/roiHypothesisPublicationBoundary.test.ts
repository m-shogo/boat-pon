import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-roi-hypothesis-sets.ts", "utf8");

test("ROI hypothesis publication verifies staged outputs and atomically revalidates destinations", () => {
  assert.match(source, /ROI_HYPOTHESIS_JSON_OUTPUT_IDENTITY_INVALID/u);
  assert.match(source, /ROI_HYPOTHESIS_MARKDOWN_OUTPUT_IDENTITY_INVALID/u);
  assert.match(source, /ROI_HYPOTHESIS_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_HYPOTHESIS_MARKDOWN_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_HYPOTHESIS_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /ROI_HYPOTHESIS_MARKDOWN_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(source, /fsyncSync\(fd\)/u);
  assert.match(source, /if \(existsSync\(path\)\) \{\s*assertCanonicalSingleLinkRegularFile\(path, destinationErrorCode\);\s*\}\s*renameSync\(verifiedTempPath, path\)/u);
});

test("ROI hypothesis destination hardening preserves fail-closed read-only analysis boundaries", () => {
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only = ON/u);
  assert.match(source, /ROI_HYPOTHESIS_DB_CHILD_LAUNCH_IDENTITY_INVALID/u);
  assert.match(source, /mkdtempSync\(join\(tmpdir\(\), "boat-pon-roi-hypothesis-"\)\)/u);
  assert.match(source, /cwd: workspace/u);
});

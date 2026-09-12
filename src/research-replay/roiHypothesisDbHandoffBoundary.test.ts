import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-hypothesis-sets.ts", "utf8");
const raw = readFileSync("scripts/analyze-roi-hypothesis-sets-raw.ts", "utf8");

test("ROI hypothesis entrypoint revalidates DB identity after settlement preflight before isolated internal analysis", () => {
  const close = entrypoint.indexOf("db.close()");
  const handoff = entrypoint.indexOf("ROI_HYPOTHESIS_DB_HANDOFF_IDENTITY_INVALID");
  const childIdentity = entrypoint.indexOf("ROI_HYPOTHESIS_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const childLaunch = entrypoint.indexOf("const analysis = spawnSync");

  assert.ok(close >= 0);
  assert.ok(handoff > close, "DB identity must be revalidated after the preflight DB closes");
  assert.ok(childIdentity > handoff, "DB identity must be revalidated immediately before isolated launch");
  assert.ok(childLaunch > childIdentity, "internal analyzer must launch only after child DB identity revalidation");
  assert.match(entrypoint, /env: \{ \.\.\.process\.env, BOAT_PON_DB_PATH: launchDbPath \}/u);
  assert.doesNotMatch(entrypoint, /await import\("\.\/analyze-roi-hypothesis-sets-internal"\)/u);
  assert.doesNotMatch(entrypoint, /analyze-roi-hypothesis-sets-raw/);
});

test("ROI hypothesis publication uses verified isolated outputs and atomic replacement", () => {
  assert.match(entrypoint, /mkdtempSync\(join\(tmpdir\(\), "boat-pon-roi-hypothesis-"\)\)/u);
  assert.match(entrypoint, /ROI_HYPOTHESIS_JSON_OUTPUT_IDENTITY_INVALID/u);
  assert.match(entrypoint, /ROI_HYPOTHESIS_MARKDOWN_OUTPUT_IDENTITY_INVALID/u);
  assert.match(entrypoint, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(entrypoint, /writeFileSync\(fd, contents, "utf8"\);\s*fsyncSync\(fd\);/u);
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(tempPath, errorCode\);\s*renameSync\(verifiedTempPath, path\);/u);
  assert.match(entrypoint, /atomicPublish\(OUT_JSON, json,/u);
  assert.match(entrypoint, /atomicPublish\(OUT_MD, markdown,/u);
  assert.match(entrypoint, /rmSync\(workspace, \{ recursive: true, force: true \}\)/u);
  assert.doesNotMatch(entrypoint, /writeFileSync\(OUT_(?:JSON|MD)/u);
});

test("ROI hypothesis guarded raw compatibility module routes through canonical DB and settlement preflight", () => {
  const canonical = raw.indexOf('await import("./analyze-roi-hypothesis-sets")');

  assert.ok(canonical >= 0);
  assert.match(raw, /ROI_HYPOTHESIS_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.doesNotMatch(raw, /ROI_HYPOTHESIS_DB_IDENTITY_INVALID/);
  assert.doesNotMatch(raw, /ROI_HYPOTHESIS_DB_MISSING/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /analyze-roi-hypothesis-sets-internal/);
});

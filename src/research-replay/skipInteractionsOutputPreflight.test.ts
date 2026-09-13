import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-skip-interactions.ts", "utf-8");

test("skip-interactions validates canonical destinations before isolated core publication", () => {
  const dbIdentity = entrypoint.indexOf("ROI_SKIP_INTERACTIONS_PRIMARY_DB_IDENTITY_INVALID");
  const reportPreflight = entrypoint.indexOf("ROI_SKIP_INTERACTIONS_PREEXISTING_REPORT_IDENTITY_INVALID");
  const workspace = entrypoint.indexOf('mkdtempSync(join(tmpdir(), "boat-pon-roi-skip-interactions-")');
  const childIdentity = entrypoint.indexOf("ROI_SKIP_INTERACTIONS_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const analysis = entrypoint.indexOf("const analysis = spawnSync");

  assert.ok(dbIdentity >= 0);
  assert.ok(reportPreflight > dbIdentity, "canonical report destinations must be checked after DB identity preflight");
  assert.ok(workspace > reportPreflight, "isolated workspace must be created only after destination preflight");
  assert.ok(childIdentity > workspace, "DB identity must be revalidated inside the isolated handoff");
  assert.ok(analysis > childIdentity, "core analyzer must launch only after final DB identity verification");
  assert.match(entrypoint, /for \(const path of \[OUT_MD, OUT_JSON\]\)/u);
  assert.match(entrypoint, /cwd: workspace/u);
  assert.doesNotMatch(entrypoint, /await import\("\.\/analyze-roi-skip-interactions-core"\)/u);
});

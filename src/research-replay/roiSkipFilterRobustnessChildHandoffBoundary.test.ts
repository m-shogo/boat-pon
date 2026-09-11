import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-roi-skip-filter-robustness.ts", "utf8");

test("skip-filter robustness revalidates the research DB immediately before isolated child launch", () => {
  const isolatedIdentityIndex = source.indexOf("ROI_SKIP_FILTER_ROBUSTNESS_DB_ISOLATED_CHILD_HANDOFF_IDENTITY_INVALID");
  const launchIdentityIndex = source.indexOf("ROI_SKIP_FILTER_ROBUSTNESS_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const spawnIndex = source.indexOf("const analysis = spawnSync(");
  const envIndex = source.indexOf("BOAT_PON_DB_PATH: launchDbPath");

  assert.ok(isolatedIdentityIndex >= 0);
  assert.ok(launchIdentityIndex > isolatedIdentityIndex);
  assert.ok(spawnIndex > launchIdentityIndex);
  assert.ok(envIndex > spawnIndex);
  assert.match(source, /const launchDbPath = assertCanonicalSingleLinkRegularFile\(\s*isolatedDbPath,/);
  assert.doesNotMatch(source, /BOAT_PON_DB_PATH: isolatedDbPath/);
});

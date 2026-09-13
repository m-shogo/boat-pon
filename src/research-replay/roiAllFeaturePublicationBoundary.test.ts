import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/search-roi-all-features-lite.ts", "utf8");

test("all-feature ROI search isolates analysis before canonical publication", () => {
  const dbIdentity = entrypoint.indexOf("ROI_ALL_FEATURE_PRIMARY_DB_IDENTITY_INVALID");
  const workspace = entrypoint.indexOf("mkdtempSync(", dbIdentity);
  const launchIdentity = entrypoint.indexOf("ROI_ALL_FEATURE_DB_CHILD_LAUNCH_IDENTITY_INVALID", workspace);
  const analysis = entrypoint.indexOf("const analysis = spawnSync", launchIdentity);
  const mdIdentity = entrypoint.indexOf("ROI_ALL_FEATURE_MD_OUTPUT_IDENTITY_INVALID", analysis);
  const jsonIdentity = entrypoint.indexOf("ROI_ALL_FEATURE_JSON_OUTPUT_IDENTITY_INVALID", analysis);
  const csvIdentity = entrypoint.indexOf("ROI_ALL_FEATURE_CSV_OUTPUT_IDENTITY_INVALID", analysis);
  const privatePathGuard = entrypoint.indexOf("ROI_ALL_FEATURE_PRIVATE_DB_PATH_REMAINS", csvIdentity);

  assert.ok(dbIdentity >= 0);
  assert.ok(workspace > dbIdentity);
  assert.ok(launchIdentity > workspace);
  assert.ok(analysis > launchIdentity);
  assert.ok(mdIdentity > analysis && jsonIdentity > analysis && csvIdentity > analysis);
  assert.ok(privatePathGuard > csvIdentity);
  assert.match(entrypoint, /cwd: workspace/);
  assert.match(entrypoint, /BOAT_PON_DB_PATH: launchDbPath/);
  assert.match(entrypoint, /JSON\.parse\(json\)/);
});

test("all-feature ROI search preflights all three destinations before atomic replacement", () => {
  const privatePathGuard = entrypoint.indexOf("ROI_ALL_FEATURE_PRIVATE_DB_PATH_REMAINS");
  const reportsIdentity = entrypoint.indexOf(
    'assertCanonicalDirectory("reports", "ROI_ALL_FEATURE_REPORTS_DIRECTORY_IDENTITY_INVALID")',
    privatePathGuard,
  );
  const completePreflight = entrypoint.indexOf("verifyExistingOutputs();", reportsIdentity);
  const jsonPublish = entrypoint.indexOf("  atomicPublish(\n    OUT_JSON,", completePreflight);
  const csvPublish = entrypoint.indexOf("  atomicPublish(\n    OUT_CSV,", jsonPublish + 1);
  const mdPublish = entrypoint.indexOf("  atomicPublish(\n    OUT_MD,", csvPublish + 1);
  const parentIdentity = entrypoint.indexOf("ROI_ALL_FEATURE_PUBLISH_PARENT_IDENTITY_INVALID");
  const tempCreate = entrypoint.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = entrypoint.indexOf("fsyncSync(fd)", tempCreate);
  const tempIdentity = entrypoint.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationIdentity = entrypoint.indexOf("assertCanonicalSingleLinkRegularFile(targetPath, destinationErrorCode)", tempIdentity);
  const parentHandoff = entrypoint.indexOf("ROI_ALL_FEATURE_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = entrypoint.indexOf("renameSync(verifiedTempPath, targetPath)", parentHandoff);

  assert.ok(reportsIdentity > privatePathGuard);
  assert.ok(completePreflight > reportsIdentity);
  assert.ok(jsonPublish > completePreflight && csvPublish > jsonPublish && mdPublish > csvPublish);
  assert.ok(parentIdentity >= 0 && tempCreate > parentIdentity);
  assert.ok(fsync > tempCreate && tempIdentity > fsync);
  assert.ok(destinationIdentity > tempIdentity);
  assert.ok(parentHandoff > destinationIdentity && rename > parentHandoff);
  assert.match(entrypoint, /ROI_ALL_FEATURE_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(entrypoint, /ROI_ALL_FEATURE_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(entrypoint, /ROI_ALL_FEATURE_CSV_PREPUBLISH_DESTINATION_IDENTITY_INVALID/);
});

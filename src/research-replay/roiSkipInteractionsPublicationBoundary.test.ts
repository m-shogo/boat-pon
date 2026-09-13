import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-roi-skip-interactions.ts", "utf8");

test("ROI skip interactions keeps isolated analysis and private DB provenance fail-closed", () => {
  const preflight = source.indexOf('run("scripts/audit-roi-skip-interactions-payout-completeness.ts")');
  const dbIdentity = source.indexOf("ROI_SKIP_INTERACTIONS_PRIMARY_DB_IDENTITY_INVALID", preflight);
  const workspace = source.indexOf("mkdtempSync(", dbIdentity);
  const launchIdentity = source.indexOf("ROI_SKIP_INTERACTIONS_DB_CHILD_LAUNCH_IDENTITY_INVALID", workspace);
  const analysis = source.indexOf("const analysis = spawnSync", launchIdentity);
  const mdIdentity = source.indexOf("ROI_SKIP_INTERACTIONS_MD_OUTPUT_IDENTITY_INVALID", analysis);
  const jsonIdentity = source.indexOf("ROI_SKIP_INTERACTIONS_JSON_OUTPUT_IDENTITY_INVALID", analysis);
  const markdownRedaction = source.indexOf("redactDbProvenance(readFileSync(verifiedMdPath", mdIdentity);
  const jsonPrivatePathGuard = source.indexOf("ROI_SKIP_INTERACTIONS_JSON_PRIVATE_DB_PATH_REMAINS", jsonIdentity);

  assert.ok(preflight >= 0);
  assert.ok(dbIdentity > preflight);
  assert.ok(workspace > dbIdentity);
  assert.ok(launchIdentity > workspace);
  assert.ok(analysis > launchIdentity);
  assert.ok(mdIdentity > analysis && jsonIdentity > analysis);
  assert.ok(markdownRedaction > mdIdentity);
  assert.ok(jsonPrivatePathGuard > jsonIdentity);
  assert.match(source, /cwd: workspace/);
  assert.match(source, /BOAT_PON_DB_PATH: launchDbPath/);
});

test("ROI skip interactions preflights the paired canonical destinations before atomic replacement", () => {
  const jsonPrivatePathGuard = source.indexOf("ROI_SKIP_INTERACTIONS_JSON_PRIVATE_DB_PATH_REMAINS");
  const reportsIdentity = source.indexOf(
    'assertCanonicalDirectory("reports", "ROI_SKIP_INTERACTIONS_REPORTS_DIRECTORY_IDENTITY_INVALID")',
    jsonPrivatePathGuard,
  );
  const pairedPreflight = source.indexOf("verifyExistingOutputs();", reportsIdentity);
  const mdPublish = source.indexOf("  atomicPublish(\n    OUT_MD,", pairedPreflight);
  const jsonPublish = source.indexOf("  atomicPublish(\n    OUT_JSON,", mdPublish + 1);
  const parentIdentity = source.indexOf("ROI_SKIP_INTERACTIONS_PUBLISH_PARENT_IDENTITY_INVALID");
  const tempCreate = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", tempCreate);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(targetPath, destinationErrorCode)", tempIdentity);
  const parentHandoff = source.indexOf(
    "ROI_SKIP_INTERACTIONS_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID",
    destinationIdentity,
  );
  const rename = source.indexOf("renameSync(verifiedTempPath, targetPath)", parentHandoff);

  assert.ok(reportsIdentity > jsonPrivatePathGuard);
  assert.ok(pairedPreflight > reportsIdentity);
  assert.ok(mdPublish > pairedPreflight && jsonPublish > mdPublish);
  assert.ok(parentIdentity >= 0 && tempCreate > parentIdentity);
  assert.ok(fsync > tempCreate && tempIdentity > fsync);
  assert.ok(destinationIdentity > tempIdentity);
  assert.ok(parentHandoff > destinationIdentity && rename > parentHandoff);
  assert.match(source, /ROI_SKIP_INTERACTIONS_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(source, /ROI_SKIP_INTERACTIONS_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(source, /ROI_SKIP_INTERACTIONS_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /ROI_SKIP_INTERACTIONS_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
});

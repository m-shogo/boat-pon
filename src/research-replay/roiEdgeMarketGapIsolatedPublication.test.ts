import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync("scripts/analyze-roi-edge-market-gap.ts", "utf8");

test("ROI edge market-gap isolates legacy writes and revalidates DB immediately before child launch", () => {
  const preflight = source.indexOf('run("scripts/audit-roi-edge-market-gap-payout-completeness.ts")');
  const boundary = source.indexOf('await import("./assert-roi-edge-market-gap-db-boundary")');
  const childIdentity = source.indexOf("ROI_EDGE_MARKET_GAP_DB_CHILD_HANDOFF_IDENTITY_INVALID");
  const workspace = source.indexOf("mkdtempSync(", childIdentity);
  const launchIdentity = source.indexOf("ROI_EDGE_MARKET_GAP_DB_CHILD_LAUNCH_IDENTITY_INVALID", workspace);
  const analysis = source.indexOf("const analysis = spawnSync", launchIdentity);

  assert.ok(preflight >= 0);
  assert.ok(boundary > preflight);
  assert.ok(childIdentity > boundary);
  assert.ok(workspace > childIdentity);
  assert.ok(launchIdentity > workspace);
  assert.ok(analysis > launchIdentity);
  assert.match(source, /cwd: workspace/);
  assert.match(source, /BOAT_PON_DB_PATH: launchDbPath/);
  assert.doesNotMatch(source, /process\.env\.BOAT_PON_DB_PATH = childDbPath/);
  assert.doesNotMatch(source, /await import\("\.\/analyze-roi-edge-market-gap-internal"\)/);
  assert.match(source, /ROI_EDGE_MARKET_GAP_INTERNAL_FAILED/);
});

test("ROI edge market-gap verifies the paired canonical publication handoff", () => {
  const analysis = source.indexOf("const analysis = spawnSync");
  const mdIdentity = source.indexOf("ROI_EDGE_MARKET_GAP_MD_WORKSPACE_OUTPUT_IDENTITY_INVALID", analysis);
  const jsonIdentity = source.indexOf("ROI_EDGE_MARKET_GAP_JSON_WORKSPACE_OUTPUT_IDENTITY_INVALID", analysis);
  const mdRead = source.indexOf('readFileSync(workspaceMd, "utf8")', mdIdentity);
  const jsonRead = source.indexOf('readFileSync(workspaceJson, "utf8")', jsonIdentity);
  const parentIdentity = source.indexOf("ROI_EDGE_MARKET_GAP_PUBLISH_PARENT_IDENTITY_INVALID");
  const tempCreate = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", tempCreate);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, errorCode)", fsync);
  const destinationIdentity = source.indexOf("assertExistingOutputIdentity(path, destinationErrorCode)", tempIdentity);
  const parentHandoff = source.indexOf(
    "ROI_EDGE_MARKET_GAP_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID",
    destinationIdentity,
  );
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);
  const reportsPreflight = source.indexOf(
    'assertCanonicalDirectory("reports", "ROI_EDGE_MARKET_GAP_REPORTS_DIRECTORY_IDENTITY_INVALID")',
    jsonRead,
  );
  const pairedPreflight = source.indexOf("verifyExistingOutputs();", reportsPreflight);
  const mdPublish = source.indexOf("  atomicPublish(\n    OUT_MD,", pairedPreflight);
  const jsonPublish = source.indexOf("  atomicPublish(\n    OUT_JSON,", mdPublish + 1);
  const postflight = source.indexOf("ROI_EDGE_MARKET_GAP_MD_OUTPUT_IDENTITY_INVALID", jsonPublish);

  assert.ok(mdIdentity > analysis && jsonIdentity > analysis);
  assert.ok(mdRead > mdIdentity && jsonRead > jsonIdentity);
  assert.ok(parentIdentity >= 0 && tempCreate > parentIdentity);
  assert.ok(fsync > tempCreate && tempIdentity > fsync);
  assert.ok(destinationIdentity > tempIdentity);
  assert.ok(parentHandoff > destinationIdentity && rename > parentHandoff);
  assert.ok(reportsPreflight > jsonRead);
  assert.ok(pairedPreflight > reportsPreflight);
  assert.ok(mdPublish > pairedPreflight && jsonPublish > mdPublish);
  assert.ok(postflight > jsonPublish);
  assert.match(source, /ROI_EDGE_MARKET_GAP_MD_PREEXISTING_IDENTITY_INVALID/);
  assert.match(source, /ROI_EDGE_MARKET_GAP_JSON_PREEXISTING_IDENTITY_INVALID/);
  assert.match(source, /ROI_EDGE_MARKET_GAP_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(source, /ROI_EDGE_MARKET_GAP_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(source, /ROI_EDGE_MARKET_GAP_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /ROI_EDGE_MARKET_GAP_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
});

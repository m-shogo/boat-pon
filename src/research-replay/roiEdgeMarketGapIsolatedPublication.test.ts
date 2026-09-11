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

test("ROI edge market-gap verifies workspace outputs before read and publishes atomically", () => {
  const analysis = source.indexOf("const analysis = spawnSync");
  const mdIdentity = source.indexOf("ROI_EDGE_MARKET_GAP_MD_WORKSPACE_OUTPUT_IDENTITY_INVALID", analysis);
  const jsonIdentity = source.indexOf("ROI_EDGE_MARKET_GAP_JSON_WORKSPACE_OUTPUT_IDENTITY_INVALID", analysis);
  const mdRead = source.indexOf('readFileSync(workspaceMd, "utf8")', mdIdentity);
  const jsonRead = source.indexOf('readFileSync(workspaceJson, "utf8")', jsonIdentity);
  const tempCreate = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)", tempCreate);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, errorCode)", fsync);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", tempIdentity);
  const postflight = source.indexOf("ROI_EDGE_MARKET_GAP_MD_OUTPUT_IDENTITY_INVALID", analysis);

  assert.ok(mdIdentity > analysis && jsonIdentity > analysis);
  assert.ok(mdRead > mdIdentity && jsonRead > jsonIdentity);
  assert.ok(tempCreate >= 0 && fsync > tempCreate);
  assert.ok(tempIdentity > fsync && rename > tempIdentity);
  assert.ok(postflight > rename);
  assert.match(source, /ROI_EDGE_MARKET_GAP_MD_PREEXISTING_IDENTITY_INVALID/);
  assert.match(source, /ROI_EDGE_MARKET_GAP_JSON_PREEXISTING_IDENTITY_INVALID/);
  assert.match(source, /ROI_EDGE_MARKET_GAP_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /ROI_EDGE_MARKET_GAP_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
});

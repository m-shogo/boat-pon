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

test("skip-filter robustness publication verifies temp, destination, and parent handoff before rename", () => {
  const helperStart = source.indexOf("function atomicPublish(");
  const executionStart = source.indexOf("const preflight = run(", helperStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(executionStart, -1);
  const helper = source.slice(helperStart, executionStart);

  const parentIdentity = helper.indexOf("ROI_SKIP_FILTER_ROBUSTNESS_PUBLISH_PARENT_IDENTITY_INVALID");
  const open = helper.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = helper.indexOf("fsyncSync(fd)");
  const tempIdentity = helper.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)");
  const destinationIdentity = helper.indexOf("verifyExistingDestination(path, destinationErrorCode)");
  const parentHandoff = helper.indexOf("ROI_SKIP_FILTER_ROBUSTNESS_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID");
  const rename = helper.indexOf("renameSync(verifiedTempPath, path)");

  assert.ok(parentIdentity >= 0 && open > parentIdentity);
  assert.ok(fsync > open && tempIdentity > fsync);
  assert.ok(destinationIdentity > tempIdentity);
  assert.ok(parentHandoff > destinationIdentity && rename > parentHandoff);
});

test("skip-filter robustness preflights both canonical destinations before first replacement", () => {
  const publicationStart = source.indexOf('mkdirSync("reports", { recursive: true });');
  assert.notEqual(publicationStart, -1);
  const publication = source.slice(publicationStart);

  const reportsIdentity = publication.indexOf("ROI_SKIP_FILTER_ROBUSTNESS_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const mdPreflight = publication.indexOf("ROI_SKIP_FILTER_ROBUSTNESS_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID");
  const jsonPreflight = publication.indexOf("ROI_SKIP_FILTER_ROBUSTNESS_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID");
  const mdPublish = publication.indexOf("atomicPublish(\n    OUT_MD,");
  const jsonPublish = publication.indexOf("atomicPublish(\n    OUT_JSON,");

  assert.ok(reportsIdentity >= 0);
  assert.ok(mdPreflight > reportsIdentity && jsonPreflight > mdPreflight);
  assert.ok(mdPublish > jsonPreflight && jsonPublish > mdPublish);
});

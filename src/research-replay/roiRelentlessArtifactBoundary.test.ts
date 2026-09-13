import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/run-roi-relentless.ts", "utf8");

test("ROI relentless verifies generated inputs before parsing them", () => {
  assert.match(source, /ROI_RELENTLESS_INPUT_IDENTITY_INVALID/u);
  assert.match(source, /const verifiedPath = assertCanonicalSingleLinkRegularFile\(path,/u);
  assert.match(source, /JSON\.parse\(readFileSync\(verifiedPath, "utf8"\)\)/u);
  assert.doesNotMatch(source, /JSON\.parse\(readFileSync\(path, "utf8"\)\)/u);
});

test("ROI relentless verifies archive sources and parent identity while revalidating destinations", () => {
  assert.match(source, /ROI_RELENTLESS_ARCHIVE_DIRECTORY_IDENTITY_INVALID/u);
  assert.match(source, /ROI_RELENTLESS_PRO_LOOP_ARCHIVE_SOURCE_IDENTITY_INVALID/u);
  assert.match(source, /ROI_RELENTLESS_ALL_FEATURE_ARCHIVE_SOURCE_IDENTITY_INVALID/u);
  assert.match(source, /ROI_RELENTLESS_PRO_LOOP_ARCHIVE_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /ROI_RELENTLESS_ALL_FEATURE_ARCHIVE_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /const verifiedSourcePath = assertCanonicalSingleLinkRegularFile\(sourcePath, sourceErrorCode\)/u);
  assert.match(source, /atomicPublish\(destinationPath, readFileSync\(verifiedSourcePath\), tempErrorCode, destinationErrorCode\)/u);
  assert.doesNotMatch(source, /copyFileSync/u);
});

test("ROI relentless preflights final paired outputs before the first final replacement", () => {
  const reportsIdentity = source.indexOf("ROI_RELENTLESS_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const completePreflight = source.indexOf("verifyExistingFinalOutputs();", reportsIdentity);
  const firstFinalPublish = source.indexOf("atomicPublish(", completePreflight);

  assert.ok(reportsIdentity >= 0);
  assert.ok(completePreflight > reportsIdentity);
  assert.ok(firstFinalPublish > completePreflight);
  assert.match(source, /ROI_RELENTLESS_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /ROI_RELENTLESS_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID/u);
});

test("ROI relentless publishes final and archive artifacts through parent-reverified atomic replacements", () => {
  assert.match(source, /ROI_RELENTLESS_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_RELENTLESS_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /ROI_RELENTLESS_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_RELENTLESS_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  const helper = source.indexOf("function atomicPublish(");
  const parentIdentity = source.indexOf("ROI_RELENTLESS_PUBLISH_PARENT_IDENTITY_INVALID", helper);
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)', helper);
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)", tempIdentity);
  const parentHandoff = source.indexOf("ROI_RELENTLESS_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);
  assert.ok(
    helper >= 0 &&
      parentIdentity > helper &&
      create > parentIdentity &&
      fsync > create &&
      tempIdentity > fsync &&
      destinationIdentity > tempIdentity &&
      parentHandoff > destinationIdentity &&
      rename > parentHandoff,
  );
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON,/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD,/u);
});

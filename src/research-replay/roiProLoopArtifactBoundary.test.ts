import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/run-roi-pro-loop.ts", "utf8");

test("ROI pro loop verifies generated inputs before parsing them", () => {
  assert.match(source, /ROI_PRO_LOOP_ALL_INPUT_IDENTITY_INVALID/u);
  assert.match(source, /ROI_PRO_LOOP_PERSONA_INPUT_IDENTITY_INVALID/u);
  assert.match(source, /const verifiedPath = assertCanonicalSingleLinkRegularFile\(path, errorCode\)/u);
  assert.match(source, /JSON\.parse\(readFileSync\(verifiedPath, "utf8"\)\)/u);
  assert.doesNotMatch(source, /JSON\.parse\(readFileSync\(ALL_JSON/u);
  assert.doesNotMatch(source, /JSON\.parse\(readFileSync\(PERSONA_JSON/u);
});

test("ROI pro loop verifies archive sources and destinations while publishing atomically", () => {
  assert.match(source, /ROI_PRO_LOOP_ARCHIVE_DIRECTORY_IDENTITY_INVALID/u);
  assert.match(source, /ROI_PRO_LOOP_ALL_SOURCE_IDENTITY_INVALID/u);
  assert.match(source, /ROI_PRO_LOOP_PERSONA_SOURCE_IDENTITY_INVALID/u);
  assert.match(source, /ROI_PRO_LOOP_ALL_ARCHIVE_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /ROI_PRO_LOOP_PERSONA_ARCHIVE_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /const verifiedSourcePath = assertCanonicalSingleLinkRegularFile\(sourcePath, sourceErrorCode\)/u);
  assert.match(source, /atomicPublish\(destinationPath, readFileSync\(verifiedSourcePath\), tempErrorCode, destinationErrorCode\)/u);
  assert.doesNotMatch(source, /copyFileSync/u);
});

test("ROI pro loop preflights final paired outputs before the first final replacement", () => {
  const reportsIdentity = source.indexOf("ROI_PRO_LOOP_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const completePreflight = source.indexOf("verifyExistingFinalOutputs();", reportsIdentity);
  const firstFinalPublish = source.indexOf("atomicPublish(", completePreflight);

  assert.ok(reportsIdentity >= 0);
  assert.ok(completePreflight > reportsIdentity);
  assert.ok(firstFinalPublish > completePreflight);
  assert.match(source, /ROI_PRO_LOOP_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /ROI_PRO_LOOP_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID/u);
});

test("ROI pro loop revalidates final and archive destinations plus parent handoff before atomic rename", () => {
  assert.match(source, /ROI_PRO_LOOP_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_PRO_LOOP_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_PRO_LOOP_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /ROI_PRO_LOOP_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  const helper = source.indexOf("function atomicPublish(");
  const parentIdentity = source.indexOf("ROI_PRO_LOOP_PUBLISH_PARENT_IDENTITY_INVALID", helper);
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)', helper);
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationGuard = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)", destinationGuard);
  const parentHandoff = source.indexOf("ROI_PRO_LOOP_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);
  assert.ok(
    helper >= 0 &&
      parentIdentity > helper &&
      create > parentIdentity &&
      fsync > create &&
      tempIdentity > fsync &&
      destinationGuard > tempIdentity &&
      destinationIdentity > destinationGuard &&
      parentHandoff > destinationIdentity &&
      rename > parentHandoff,
  );
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON,/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD,/u);
});

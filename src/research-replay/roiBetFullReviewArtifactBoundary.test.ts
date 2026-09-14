import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/run-roi-bet-full-review.ts", "utf8");

test("ROI bet full review binds required and optional input reads to verified descriptors", () => {
  assert.match(source, /ROI_BET_FULL_REVIEW_REQUIRED_INPUT_MISSING/u);
  assert.match(source, /ROI_BET_FULL_REVIEW_REQUIRED_INPUT_IDENTITY_INVALID/u);
  assert.match(source, /ROI_BET_FULL_REVIEW_OPTIONAL_INPUT_IDENTITY_INVALID/u);
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(path,/u);
  assert.match(source, /JSON\.parse\(readGovernanceFileUtf8\(path, "reports"\)\)/u);
  assert.doesNotMatch(source, /JSON\.parse\(readFileSync\(verifiedPath, "utf8"\)\)/u);
  assert.doesNotMatch(source, /JSON\.parse\(readFileSync\(path, "utf8"\)\)/u);
});

test("ROI bet full review preflights the complete paired destination set before the first replacement", () => {
  const reportsIdentity = source.indexOf("ROI_BET_FULL_REVIEW_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const completePreflight = source.indexOf("verifyExistingOutputs();", reportsIdentity);
  const firstPublish = source.indexOf("atomicPublish(", completePreflight);

  assert.ok(reportsIdentity >= 0);
  assert.ok(completePreflight > reportsIdentity);
  assert.ok(firstPublish > completePreflight);
  assert.match(source, /ROI_BET_FULL_REVIEW_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /ROI_BET_FULL_REVIEW_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID/u);
});

test("ROI bet full review publishes JSON and Markdown through verified atomic temp files with parent handoff", () => {
  assert.match(source, /ROI_BET_FULL_REVIEW_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_BET_FULL_REVIEW_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_BET_FULL_REVIEW_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /ROI_BET_FULL_REVIEW_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  const helper = source.indexOf("function atomicPublish(");
  const parentIdentity = source.indexOf("ROI_BET_FULL_REVIEW_PUBLISH_PARENT_IDENTITY_INVALID", helper);
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)', helper);
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationGuard = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf(
    "assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)",
    destinationGuard,
  );
  const parentHandoff = source.indexOf("ROI_BET_FULL_REVIEW_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
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

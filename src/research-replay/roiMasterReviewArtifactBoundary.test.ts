import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/run-roi-master-review.ts", "utf8");

test("ROI master review reads every existing input through descriptor-bound verification", () => {
  assert.match(source, /ROI_MASTER_REVIEW_INPUT_IDENTITY_INVALID/u);
  assert.match(source, /import \{ readGovernanceFileUtf8 \} from "\.\.\/src\/research\/governance\/safeFs";/u);
  const helper = source.indexOf("function read(path: string)");
  const descriptorRead = source.indexOf("readGovernanceFileUtf8(path, process.cwd())", helper);
  const parse = source.indexOf("JSON.parse(text)", descriptorRead);
  assert.ok(helper >= 0 && descriptorRead > helper && parse > descriptorRead);
  assert.doesNotMatch(source, /JSON\.parse\(readFileSync\(verifiedPath, "utf8"\)\)/u);
  assert.doesNotMatch(source, /JSON\.parse\(readFileSync\(path, "utf8"\)\)/u);
});

test("ROI master review preflights the complete paired destination set before the first replacement", () => {
  const reportsIdentity = source.indexOf("ROI_MASTER_REVIEW_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const completePreflight = source.indexOf("verifyExistingOutputs();", reportsIdentity);
  const firstPublish = source.indexOf("atomicPublish(", completePreflight);

  assert.ok(reportsIdentity >= 0);
  assert.ok(completePreflight > reportsIdentity);
  assert.ok(firstPublish > completePreflight);
  assert.match(source, /ROI_MASTER_REVIEW_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /ROI_MASTER_REVIEW_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID/u);
});

test("ROI master review revalidates existing destinations and parent before atomic replacement", () => {
  assert.match(source, /ROI_MASTER_REVIEW_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_MASTER_REVIEW_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /ROI_MASTER_REVIEW_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_MASTER_REVIEW_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  const helper = source.indexOf("function atomicPublish(");
  const parentIdentity = source.indexOf("ROI_MASTER_REVIEW_PUBLISH_PARENT_IDENTITY_INVALID", helper);
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)', helper);
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationGuard = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf(
    "assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)",
    destinationGuard,
  );
  const parentHandoff = source.indexOf("ROI_MASTER_REVIEW_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
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

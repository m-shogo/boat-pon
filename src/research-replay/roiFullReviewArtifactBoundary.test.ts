import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/run-roi-full-review.ts", "utf8");

test("ROI full review reads source and upstream reports through descriptor-bound verification", () => {
  assert.match(source, /ROI_FULL_REVIEW_ALL_FEATURE_SOURCE_IDENTITY_INVALID/);
  assert.match(source, /ROI_FULL_REVIEW_ALL_FEATURE_IDENTITY_INVALID/);
  assert.match(source, /ROI_FULL_REVIEW_AUTOPILOT_IDENTITY_INVALID/);
  assert.match(source, /ROI_FULL_REVIEW_MATRIX_IDENTITY_INVALID/);
  assert.match(source, /import \{ readGovernanceFileUtf8 \} from "\.\.\/src\/research\/governance\/safeFs";/u);

  const verifiedHelper = source.indexOf("function readVerifiedText(");
  const descriptorRead = source.indexOf("readGovernanceFileUtf8(path, process.cwd())", verifiedHelper);
  const requiredHelper = source.indexOf("function readRequiredText(", descriptorRead);
  const requiredRead = source.indexOf("readVerifiedText(path, identityErrorCode)", requiredHelper);
  const optionalHelper = source.indexOf("function readOptional<T>", requiredRead);
  const optionalRead = source.indexOf("readVerifiedText(path, identityErrorCode)", optionalHelper);
  assert.ok(verifiedHelper >= 0 && descriptorRead > verifiedHelper);
  assert.ok(requiredHelper > descriptorRead && requiredRead > requiredHelper);
  assert.ok(optionalHelper > requiredRead && optionalRead > optionalHelper);
  assert.doesNotMatch(source, /readFileSync\(verifiedPath/u);
});

test("ROI full review keeps official-payout gate before final decision", () => {
  const allFeatureRead = source.indexOf("const allFeature = readOptional<GenericReport>(");
  const gate = source.indexOf("assertOfficialPayoutReport(allFeature);");
  const decision = source.indexOf("const finalDecision = decide(");
  assert.ok(allFeatureRead >= 0 && gate > allFeatureRead && decision > gate);
  assert.match(source, /metricBasis: "official_payout_yen"/);
});

test("ROI full review preflights canonical reports directory and both destinations before first replacement", () => {
  const reportsDirectory = source.indexOf("ROI_FULL_REVIEW_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const preflightJson = source.indexOf("verifyExistingOutput(OUT_JSON", reportsDirectory);
  const preflightMd = source.indexOf("verifyExistingOutput(OUT_MD", preflightJson);
  const jsonPublish = source.indexOf("atomicPublish(\n  OUT_JSON", preflightMd);
  const mdPublish = source.indexOf("atomicPublish(\n  OUT_MD", jsonPublish);
  assert.ok(reportsDirectory >= 0);
  assert.ok(preflightJson > reportsDirectory && preflightMd > preflightJson);
  assert.ok(jsonPublish > preflightMd && mdPublish > jsonPublish, "both destinations must be preflighted before the first replacement");
});

test("ROI full review validates publish parent handoff and uses fsynced exclusive temp files", () => {
  const helper = source.indexOf("function atomicPublish(");
  const parentIdentity = source.indexOf("ROI_FULL_REVIEW_PUBLISH_PARENT_IDENTITY_INVALID", helper);
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempIdentityErrorCode)", fsync);
  const destinationIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationIdentityErrorCode)", tempIdentity);
  const parentHandoff = source.indexOf("ROI_FULL_REVIEW_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);
  assert.ok(helper >= 0 && parentIdentity > helper);
  assert.ok(create > parentIdentity && fsync > create && tempIdentity > fsync);
  assert.ok(destinationIdentity > tempIdentity && parentHandoff > destinationIdentity && rename > parentHandoff);
  assert.match(source, /ROI_FULL_REVIEW_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /ROI_FULL_REVIEW_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(source, /ROI_FULL_REVIEW_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /ROI_FULL_REVIEW_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
});

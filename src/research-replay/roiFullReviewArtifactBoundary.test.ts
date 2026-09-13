import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/run-roi-full-review.ts", "utf8");

test("ROI full review verifies source and upstream report identities before reading", () => {
  assert.match(source, /ROI_FULL_REVIEW_ALL_FEATURE_SOURCE_IDENTITY_INVALID/);
  assert.match(source, /ROI_FULL_REVIEW_ALL_FEATURE_IDENTITY_INVALID/);
  assert.match(source, /ROI_FULL_REVIEW_AUTOPILOT_IDENTITY_INVALID/);
  assert.match(source, /ROI_FULL_REVIEW_MATRIX_IDENTITY_INVALID/);

  const sourceIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(path, identityErrorCode)");
  const sourceRead = source.indexOf('readFileSync(verifiedPath, "utf8")', sourceIdentity);
  assert.ok(sourceIdentity >= 0 && sourceRead > sourceIdentity);

  const optionalHelper = source.indexOf("function readOptional<T>");
  const optionalIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(path, identityErrorCode)", optionalHelper);
  const optionalRead = source.indexOf('readFileSync(verifiedPath, "utf8")', optionalIdentity);
  assert.ok(optionalHelper >= 0 && optionalIdentity > optionalHelper && optionalRead > optionalIdentity);
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

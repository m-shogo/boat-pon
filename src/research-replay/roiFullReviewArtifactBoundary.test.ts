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

test("ROI full review validates existing outputs and publishes atomically", () => {
  const preflightJson = source.indexOf("verifyExistingOutput(OUT_JSON");
  const preflightMd = source.indexOf("verifyExistingOutput(OUT_MD");
  const jsonPublish = source.indexOf("atomicPublish(\n  OUT_JSON");
  const mdPublish = source.indexOf("atomicPublish(\n  OUT_MD");
  assert.ok(preflightJson >= 0 && preflightMd > preflightJson && jsonPublish > preflightMd && mdPublish > jsonPublish);

  const create = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, identityErrorCode)", fsync);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", identity);
  assert.ok(create >= 0 && fsync > create && identity > fsync && rename > identity);
  assert.match(source, /ROI_FULL_REVIEW_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /ROI_FULL_REVIEW_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
});

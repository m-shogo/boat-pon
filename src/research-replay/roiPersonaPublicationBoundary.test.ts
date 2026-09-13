import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/roi-pro-persona-review.ts", "utf8");

test("ROI persona review preflights canonical reports directory and both destinations before first replacement", () => {
  const reportsDirectory = source.indexOf("ROI_PERSONA_REVIEW_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const preflightJson = source.indexOf("verifyExistingOutput(OUT_JSON", reportsDirectory);
  const preflightMd = source.indexOf("verifyExistingOutput(OUT_MD", preflightJson);
  const jsonPublish = source.indexOf("atomicPublish(\n  OUT_JSON", preflightMd);
  const mdPublish = source.indexOf("atomicPublish(\n  OUT_MD", jsonPublish);
  assert.ok(reportsDirectory >= 0);
  assert.ok(preflightJson > reportsDirectory && preflightMd > preflightJson);
  assert.ok(jsonPublish > preflightMd && mdPublish > jsonPublish, "both destinations must be preflighted before the first replacement");
});

test("ROI persona review validates publication parent handoff around fsynced exclusive temp files", () => {
  const helper = source.indexOf("function atomicPublish(");
  const parentIdentity = source.indexOf("ROI_PERSONA_REVIEW_PUBLISH_PARENT_IDENTITY_INVALID", helper);
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, identityErrorCode)", fsync);
  const destinationIdentity = source.indexOf("verifyExistingOutput(path, destinationIdentityErrorCode)", tempIdentity);
  const parentHandoff = source.indexOf("ROI_PERSONA_REVIEW_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);
  assert.ok(helper >= 0 && parentIdentity > helper);
  assert.ok(create > parentIdentity && fsync > create && tempIdentity > fsync);
  assert.ok(destinationIdentity > tempIdentity && parentHandoff > destinationIdentity && rename > parentHandoff);
  assert.match(source, /ROI_PERSONA_REVIEW_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /ROI_PERSONA_REVIEW_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(source, /ROI_PERSONA_REVIEW_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /ROI_PERSONA_REVIEW_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
});

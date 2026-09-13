import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-roi-improvement-validation.ts", "utf8");

test("ROI improvement validation publishes through verified atomic handoffs", () => {
  const helperStart = source.indexOf("function atomicPublish(");
  const settlementStart = source.indexOf("type SettlementIntegrityRow", helperStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(settlementStart, -1);
  const helper = source.slice(helperStart, settlementStart);

  const parentIdentity = helper.indexOf("ROI_IMPROVEMENT_VALIDATION_PUBLISH_PARENT_IDENTITY_INVALID");
  const exclusiveOpen = helper.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = helper.indexOf("fsyncSync(fd)");
  const tempIdentity = helper.indexOf("const verifiedTempPath = assertCanonicalSingleLinkRegularFile");
  const destinationIdentity = helper.indexOf("verifyExistingDestination(");
  const parentHandoff = helper.indexOf("ROI_IMPROVEMENT_VALIDATION_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID");
  const rename = helper.indexOf("renameSync(verifiedTempPath, path)");

  assert.ok(parentIdentity >= 0 && exclusiveOpen > parentIdentity);
  assert.ok(fsync > exclusiveOpen && tempIdentity > fsync);
  assert.ok(destinationIdentity > tempIdentity);
  assert.ok(parentHandoff > destinationIdentity && rename > parentHandoff);
});

test("ROI improvement validation preflights both destinations before first replacement", () => {
  const publicationStart = source.indexOf('if (!existsSync("reports")) mkdirSync("reports", { recursive: true });');
  assert.notEqual(publicationStart, -1);
  const publication = source.slice(publicationStart);

  const reportsIdentity = publication.indexOf("ROI_IMPROVEMENT_VALIDATION_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const mdPreflight = publication.indexOf("ROI_IMPROVEMENT_VALIDATION_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID");
  const jsonPreflight = publication.indexOf("ROI_IMPROVEMENT_VALIDATION_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID");
  const mdPublish = publication.indexOf('atomicPublish(OUT_MD, md, "MD")');
  const jsonPublish = publication.indexOf('atomicPublish(OUT_JSON, JSON.stringify(json, null, 2), "JSON")');

  assert.ok(reportsIdentity >= 0);
  assert.ok(mdPreflight > reportsIdentity && jsonPreflight > mdPreflight);
  assert.ok(mdPublish > jsonPreflight && jsonPublish > mdPublish);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD/);
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON/);
});

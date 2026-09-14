import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-roi-all-data-sweep.ts", "utf8");

test("ROI all-data sweep binds every existing upstream report read to a verified descriptor", () => {
  assert.match(source, /ROI_ALL_DATA_SWEEP_INPUT_IDENTITY_INVALID/u);
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(path,/u);
  assert.match(source, /JSON\.parse\(readGovernanceFileUtf8\(path, REPORT_DIR\)\)/u);
  assert.doesNotMatch(source, /JSON\.parse\(readFileSync\(verifiedPath, "utf8"\)\)/u);
  assert.doesNotMatch(source, /JSON\.parse\(readFileSync\(path, "utf8"\)\)/u);
});

test("ROI all-data sweep preflights the complete destination set before the first publication", () => {
  const preflightHelper = source.indexOf("function preflightPublicationDestinations");
  const parentIdentity = source.indexOf("ROI_ALL_DATA_SWEEP_PUBLISH_PARENT_IDENTITY_INVALID", preflightHelper);
  const mdDestination = source.indexOf("ROI_ALL_DATA_SWEEP_MD_PUBLISH_DESTINATION_IDENTITY_INVALID", parentIdentity);
  const jsonDestination = source.indexOf("ROI_ALL_DATA_SWEEP_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID", mdDestination);
  const preflightCall = source.indexOf("preflightPublicationDestinations();", jsonDestination);
  const firstPublish = source.indexOf("atomicPublish(\n  OUT_MD", preflightCall);

  assert.ok(preflightHelper >= 0);
  assert.ok(parentIdentity > preflightHelper);
  assert.ok(mdDestination > parentIdentity);
  assert.ok(jsonDestination > mdDestination);
  assert.ok(preflightCall > jsonDestination);
  assert.ok(firstPublish > preflightCall);
  assert.match(source, /!stat\.isDirectory\(\) \|\| stat\.isSymbolicLink\(\)/u);
  assert.match(source, /realpathSync\(path\) !== resolvedPath/u);
});

test("ROI all-data sweep publishes JSON and Markdown through verified atomic temp files", () => {
  const helper = source.indexOf("function atomicPublish");
  const parentIdentity = source.indexOf("ROI_ALL_DATA_SWEEP_PUBLISH_PARENT_IDENTITY_INVALID", helper);
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationIdentity = source.indexOf("verifyExistingOutput(path, destinationErrorCode)", tempIdentity);
  const parentHandoff = source.indexOf("ROI_ALL_DATA_SWEEP_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);

  assert.ok(
    parentIdentity >= 0 && create > parentIdentity && fsync > create && tempIdentity > fsync && destinationIdentity > tempIdentity && parentHandoff > destinationIdentity && rename > parentHandoff,
    "publication must be parent-verified, exclusive, durable, temp-verified, destination-reverified, parent-reverified, and atomic",
  );
  assert.match(source, /ROI_ALL_DATA_SWEEP_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_ALL_DATA_SWEEP_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /ROI_ALL_DATA_SWEEP_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /ROI_ALL_DATA_SWEEP_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /if \(!existsSync\(path\)\) return;\s*assertCanonicalSingleLinkRegularFile\(path, destinationErrorCode\);/s);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD,/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON,/u);
});

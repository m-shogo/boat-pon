import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/run-roi-search-suite.ts", "utf8");

test("ROI search suite verifies generated JSON inputs immediately before read", () => {
  assert.match(source, /ROI_SEARCH_SUITE_INPUT_IDENTITY_INVALID/u);
  assert.match(source, /const verifiedInputPath = assertCanonicalSingleLinkRegularFile\(/u);
  assert.match(source, /JSON\.parse\(readFileSync\(verifiedInputPath, "utf8"\)\)/u);
});

test("ROI search suite publishes summary through an exclusive verified temp file and reverifies parent and destination at handoff", () => {
  const atomic = source.indexOf("function atomicPublish");
  const parentIdentity = source.indexOf("ROI_SEARCH_SUITE_SUMMARY_PUBLISH_PARENT_IDENTITY_INVALID", atomic);
  const open = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", open);
  const tempIdentity = source.indexOf("ROI_SEARCH_SUITE_SUMMARY_PUBLISH_TEMP_IDENTITY_INVALID", fsync);
  const destinationCheck = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf("ROI_SEARCH_SUITE_SUMMARY_PUBLISH_DESTINATION_IDENTITY_INVALID", destinationCheck);
  const parentHandoff = source.indexOf("ROI_SEARCH_SUITE_SUMMARY_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);

  assert.ok(parentIdentity > atomic);
  assert.ok(
    open > parentIdentity
      && fsync > open
      && tempIdentity > fsync
      && destinationCheck > tempIdentity
      && destinationIdentity > destinationCheck
      && parentHandoff > destinationIdentity
      && rename > parentHandoff,
  );
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(/u);
  assert.match(source, /assertCanonicalDirectory\(parentPath,/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_SUMMARY/u);
  assert.doesNotMatch(source, /writeFileSync\("reports\/roi-search-suite-summary\.md"/u);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/plan-next-research-action.ts", "utf8");

test("next research action verifies governor identity before parsing", () => {
  const identity = source.indexOf("const verifiedGovernorPath = assertCanonicalSingleLinkRegularFile(");
  const read = source.indexOf('readFileSync(verifiedGovernorPath, "utf-8")');
  assert.ok(identity >= 0 && read > identity);
  assert.match(source, /NEXT_RESEARCH_ACTION_GOVERNOR_MISSING/);
  assert.match(source, /NEXT_RESEARCH_ACTION_GOVERNOR_IDENTITY_INVALID/);
  assert.doesNotMatch(source, /readFileSync\(GOV_JSON/);
});

test("next research action validates parent and complete destination set before publication", () => {
  const parentPreflight = source.indexOf(
    'assertCanonicalDirectory("reports", "NEXT_RESEARCH_ACTION_PUBLISH_PARENT_IDENTITY_INVALID")',
  );
  const preflightMd = source.indexOf("verifyExistingOutput(OUT_MD");
  const preflightJson = source.indexOf("verifyExistingOutput(OUT_JSON");
  const mdPublish = source.indexOf("atomicPublish(\n  OUT_MD");
  const jsonPublish = source.indexOf("atomicPublish(\n  OUT_JSON");
  assert.ok(
    parentPreflight >= 0 &&
      preflightMd > parentPreflight &&
      preflightJson > preflightMd &&
      mdPublish > preflightJson &&
      jsonPublish > mdPublish,
  );

  const parentIdentity = source.indexOf(
    'assertCanonicalDirectory(parentPath, "NEXT_RESEARCH_ACTION_PUBLISH_PARENT_IDENTITY_INVALID")',
  );
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempIdentityErrorCode)", fsync);
  const destinationIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationIdentityErrorCode)", tempIdentity);
  const parentHandoff = source.indexOf(
    'assertCanonicalDirectory(parentPath, "NEXT_RESEARCH_ACTION_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID")',
    destinationIdentity,
  );
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);
  assert.ok(
    parentIdentity >= 0 &&
      create > parentIdentity &&
      fsync > create &&
      tempIdentity > fsync &&
      destinationIdentity > tempIdentity &&
      parentHandoff > destinationIdentity &&
      rename > parentHandoff,
  );

  assert.match(source, /NEXT_RESEARCH_ACTION_PUBLISH_PARENT_IDENTITY_INVALID/);
  assert.match(source, /NEXT_RESEARCH_ACTION_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID/);
  assert.match(source, /NEXT_RESEARCH_ACTION_PREEXISTING_MD_IDENTITY_INVALID/);
  assert.match(source, /NEXT_RESEARCH_ACTION_PREEXISTING_JSON_IDENTITY_INVALID/);
  assert.match(source, /NEXT_RESEARCH_ACTION_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /NEXT_RESEARCH_ACTION_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(source, /NEXT_RESEARCH_ACTION_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /NEXT_RESEARCH_ACTION_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
});

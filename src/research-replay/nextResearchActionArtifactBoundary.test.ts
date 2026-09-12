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

test("next research action validates existing outputs and revalidates destinations before atomic replacement", () => {
  const preflightMd = source.indexOf("verifyExistingOutput(OUT_MD");
  const preflightJson = source.indexOf("verifyExistingOutput(OUT_JSON");
  const mdPublish = source.indexOf("atomicPublish(\n  OUT_MD");
  const jsonPublish = source.indexOf("atomicPublish(\n  OUT_JSON");
  assert.ok(preflightMd >= 0 && preflightJson > preflightMd && mdPublish > preflightJson && jsonPublish > mdPublish);

  const create = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempIdentityErrorCode)", fsync);
  const destinationIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationIdentityErrorCode)", tempIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);
  assert.ok(
    create >= 0 &&
      fsync > create &&
      tempIdentity > fsync &&
      destinationIdentity > tempIdentity &&
      rename > destinationIdentity,
  );

  assert.match(source, /NEXT_RESEARCH_ACTION_PREEXISTING_MD_IDENTITY_INVALID/);
  assert.match(source, /NEXT_RESEARCH_ACTION_PREEXISTING_JSON_IDENTITY_INVALID/);
  assert.match(source, /NEXT_RESEARCH_ACTION_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /NEXT_RESEARCH_ACTION_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(source, /NEXT_RESEARCH_ACTION_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /NEXT_RESEARCH_ACTION_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
});

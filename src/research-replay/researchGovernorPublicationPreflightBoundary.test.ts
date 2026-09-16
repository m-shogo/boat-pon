import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-research-governor.ts", "utf8");

test("research governor preflights the complete destination set before first canonical publication", () => {
  const markdownReady = source.indexOf("const markdown = readVerifiedWorkspaceOutput(");
  const jsonReady = source.indexOf("const json = readVerifiedWorkspaceOutput(", markdownReady);
  const outputsReady = Math.max(markdownReady, jsonReady);
  const reportsIdentity = source.indexOf(
    'assertCanonicalDirectory("reports", "RESEARCH_GOVERNOR_REPORTS_DIRECTORY_IDENTITY_INVALID")',
    outputsReady,
  );
  const destinationPreflight = source.indexOf("verifyExistingOutputPaths();", reportsIdentity);
  const firstPublish = source.indexOf("atomicPublish(", destinationPreflight);

  assert.ok(markdownReady >= 0);
  assert.ok(jsonReady > markdownReady);
  assert.ok(reportsIdentity > outputsReady);
  assert.ok(destinationPreflight > reportsIdentity);
  assert.ok(firstPublish > destinationPreflight);
});

test("research governor revalidates canonical publication parent before temp creation and rename", () => {
  const helperStart = source.indexOf("function atomicPublish(");
  const parentInitial = source.indexOf("RESEARCH_GOVERNOR_PUBLISH_PARENT_IDENTITY_INVALID", helperStart);
  const tempOpen = source.indexOf('openSync(tempPath, "wx", 0o600)', helperStart);
  const parentHandoff = source.indexOf("RESEARCH_GOVERNOR_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", helperStart);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", helperStart);

  assert.ok(helperStart >= 0);
  assert.ok(parentInitial > helperStart);
  assert.ok(tempOpen > parentInitial);
  assert.ok(parentHandoff > tempOpen);
  assert.ok(rename > parentHandoff);
});
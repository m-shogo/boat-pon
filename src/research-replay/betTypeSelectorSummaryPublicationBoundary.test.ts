import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-bet-type-selector-summary.ts", "utf8");

test("bet-type selector summary preflights the complete destination set before first publication", () => {
  const publicationBlock = source.indexOf("const outputs = readIsolatedOutputs(workspace, verifiedDbPath);");
  const reportsIdentity = source.indexOf(
    'assertCanonicalDirectory("reports", "BET_TYPE_SELECTOR_REPORTS_DIRECTORY_IDENTITY_INVALID")',
    publicationBlock,
  );
  const destinationPreflight = source.indexOf("verifyExistingOutputPaths();", reportsIdentity);
  const firstPublish = source.indexOf("atomicPublish(", destinationPreflight);

  assert.ok(publicationBlock >= 0);
  assert.ok(reportsIdentity > publicationBlock);
  assert.ok(destinationPreflight > reportsIdentity);
  assert.ok(firstPublish > destinationPreflight);
});

test("bet-type selector summary revalidates publication parent before temp creation and rename", () => {
  const helperStart = source.indexOf("function atomicPublish(");
  const parentInitial = source.indexOf("BET_TYPE_SELECTOR_PUBLISH_PARENT_IDENTITY_INVALID", helperStart);
  const tempOpen = source.indexOf('openSync(tempPath, "wx", 0o600)', helperStart);
  const parentHandoff = source.indexOf("BET_TYPE_SELECTOR_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", helperStart);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", helperStart);

  assert.ok(helperStart >= 0);
  assert.ok(parentInitial > helperStart);
  assert.ok(tempOpen > parentInitial);
  assert.ok(parentHandoff > tempOpen);
  assert.ok(rename > parentHandoff);
});

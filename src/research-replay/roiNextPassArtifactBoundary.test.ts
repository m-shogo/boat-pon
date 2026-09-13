import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/summarize-roi-next-pass.ts", "utf8");

test("ROI next-pass verifies both generated inputs before reading", () => {
  assert.match(source, /ROI_NEXT_PASS_SEARCH_INPUT_IDENTITY_INVALID/u);
  assert.match(source, /JSON\.parse\(readFileSync\(verifiedSearchPath, "utf8"\)\)/u);
  assert.match(source, /ROI_NEXT_PASS_HYPOTHESIS_INPUT_IDENTITY_INVALID/u);
  assert.match(source, /JSON\.parse\(readFileSync\(verifiedHypothesisPath, "utf8"\)\)/u);
});

test("ROI next-pass publishes output atomically through verified parent, temp, destination, and handoff identities", () => {
  const helper = source.indexOf("function atomicPublish");
  const parentIdentityIndex = source.indexOf("ROI_NEXT_PASS_PUBLISH_PARENT_IDENTITY_INVALID", helper);
  const createIndex = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentityIndex);
  const fsyncIndex = source.indexOf("fsyncSync(fd)", createIndex);
  const tempIdentityIndex = source.indexOf("ROI_NEXT_PASS_PUBLISH_TEMP_IDENTITY_INVALID", fsyncIndex);
  const destinationIdentityIndex = source.indexOf("ROI_NEXT_PASS_PUBLISH_DESTINATION_IDENTITY_INVALID", tempIdentityIndex);
  const parentHandoffIndex = source.indexOf("ROI_NEXT_PASS_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentityIndex);
  const renameIndex = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoffIndex);

  assert.ok(helper >= 0);
  assert.ok(parentIdentityIndex > helper);
  assert.ok(createIndex > parentIdentityIndex);
  assert.ok(fsyncIndex > createIndex);
  assert.ok(tempIdentityIndex > fsyncIndex);
  assert.ok(destinationIdentityIndex > tempIdentityIndex);
  assert.ok(parentHandoffIndex > destinationIdentityIndex);
  assert.ok(renameIndex > parentHandoffIndex);
  assert.match(source, /!stat\.isDirectory\(\) \|\| stat\.isSymbolicLink\(\)/u);
  assert.match(source, /realpathSync\(path\) !== resolvedPath/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT,/u);
});

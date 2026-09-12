import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-historical-ranking-forward.ts", "utf8");

test("historical ranking publishes reports and model atomically after identity checks", () => {
  assert.doesNotMatch(source, /writeFileSync\(OUT_(?:JSON|MD|MODEL)/u);

  const helperStart = source.indexOf("function atomicPublish(");
  const helperEnd = source.indexOf("function trainModel(");
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "atomic publication helper must exist before model training helper");
  const helper = source.slice(helperStart, helperEnd);

  const exclusiveTemp = helper.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = helper.indexOf("fsyncSync(fd)");
  const tempIdentity = helper.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempIdentityErrorCode)");
  const destinationExists = helper.indexOf("if (existsSync(path))");
  const destinationIdentity = helper.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationIdentityErrorCode)");
  const rename = helper.indexOf("renameSync(verifiedTempPath, path)");

  assert.ok(exclusiveTemp >= 0, "publication must use an exclusive temporary file");
  assert.ok(fsync > exclusiveTemp, "temporary output must be fsynced after exclusive creation");
  assert.ok(tempIdentity > fsync, "temporary output identity must be verified after fsync");
  assert.ok(destinationExists > tempIdentity, "destination must be rechecked immediately before publication");
  assert.ok(destinationIdentity > destinationExists, "existing destination identity must be fail-closed");
  assert.ok(rename > destinationIdentity, "atomic rename must happen only after destination revalidation");

  for (const target of ["OUT_JSON", "OUT_MD", "OUT_MODEL"]) {
    assert.match(source, new RegExp(`atomicPublish\\(\\n  ${target},`, "u"));
  }
});

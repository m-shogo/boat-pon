import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/audit-t5-historical-market-forward.ts", "utf8");

test("T-5 historical-market forward publishes reports atomically after identity checks", () => {
  assert.doesNotMatch(source, /writeFileSync\(OUT_(?:JSON|MD)/u);

  const helperStart = source.indexOf("function atomicPublish(");
  const helperEnd = source.indexOf("function loadCohort(");
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "atomic publication helper must exist before cohort loading helpers");
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

  assert.match(source, /atomicPublish\(\n  OUT_JSON,/u);
  assert.match(source, /atomicPublish\(\n  OUT_MD,/u);
});

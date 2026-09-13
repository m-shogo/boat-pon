import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/research-replay-n1-payout.ts", "utf8");

test("N1 payout report publication verifies canonical parent before temp creation and rename", () => {
  const helper = source.indexOf("function atomicPublish");
  const parentIdentity = source.indexOf("N1_PAYOUT_REPORT_PARENT_IDENTITY_INVALID", helper);
  const tempCreate = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", tempCreate);
  const tempIdentity = source.indexOf("N1_PAYOUT_REPORT_TEMP_IDENTITY_INVALID", fsync);
  const destinationIdentity = source.indexOf("N1_PAYOUT_REPORT_DESTINATION_IDENTITY_INVALID", tempIdentity);
  const parentHandoff = source.indexOf("N1_PAYOUT_REPORT_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);

  assert.ok(helper >= 0);
  assert.ok(parentIdentity > helper);
  assert.ok(tempCreate > parentIdentity);
  assert.ok(fsync > tempCreate);
  assert.ok(tempIdentity > fsync);
  assert.ok(destinationIdentity > tempIdentity);
  assert.ok(parentHandoff > destinationIdentity);
  assert.ok(rename > parentHandoff);
  assert.match(source, /!stat\.isDirectory\(\) \|\| stat\.isSymbolicLink\(\)/);
  assert.match(source, /realpathSync\(path\) !== resolvedPath/);
});

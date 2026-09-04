import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../scripts/generate-n2-trifecta-private-daily-plan.ts", import.meta.url),
  "utf8",
);

test("private daily plan binds primary reads to a verified filesystem identity", () => {
  assert.match(source, /function verifiedPrimaryDbPath\(path: string\): string/);
  assert.match(source, /lstatSync\(lexicalPath\)/);
  assert.match(source, /leaf\.isSymbolicLink\(\) \|\| !leaf\.isFile\(\)/);
  assert.match(source, /stat\.nlink !== 1/);
  assert.match(source, /realpathSync\(lexicalPath\) !== lexicalPath/);
  assert.match(source, /const before = dbMeta\(primaryDbPath\);/);
  assert.match(source, /const venueCodes = discoverVenueCodes\(before\.path, requestedDate\);/);
  assert.match(source, /primaryDbPath: before\.path,/);
  assert.match(source, /const after = dbMeta\(before\.path\);/);
  assert.doesNotMatch(source, /const venueCodes = discoverVenueCodes\(primaryDbPath, requestedDate\);/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./n2OfficialProgramCanaryReviewBundleExecutor.ts", import.meta.url),
  "utf8",
);

test("official program canary review verifies database identity before authority reads", () => {
  assert.match(source, /const lexicalPath = resolve\(path\);/);
  assert.match(source, /const leaf = lstatSync\(lexicalPath\);/);
  assert.match(source, /leaf\.isSymbolicLink\(\) \|\| !leaf\.isFile\(\)/);
  assert.match(source, /stat\.nlink !== 1/);
  assert.match(source, /realpathSync\(lexicalPath\) !== lexicalPath/);
  assert.match(source, /errors\.push\(\.\.\.databaseBlocks\(primaryDbPath, "PRIMARY_DB"\)\);/);
  assert.match(source, /errors\.push\(\.\.\.databaseBlocks\(ctx\.sidecarPath, "SIDECAR"\)\);/);
  assert.match(source, /function openImmutableSidecar\(path: string\): DatabaseSync/);
  assert.match(source, /const blocks = databaseBlocks\(path, "SIDECAR"\);/);
  assert.match(source, /const sidecar = openImmutableSidecar\(ctx\.sidecarPath\);/);
  assert.doesNotMatch(source, /function openImmutable\(path: string\): DatabaseSync/);
});

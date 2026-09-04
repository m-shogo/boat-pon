import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../scripts/check-official-program-live-readiness.ts", import.meta.url),
  "utf8",
);

test("official program live readiness rejects aliased primary database identities", () => {
  assert.match(source, /realpathSync/);
  assert.match(source, /const dbLeaf = lstatSync\(dbPath\);/);
  assert.match(source, /const dbStat = statSync\(dbPath\);/);
  assert.match(source, /dbLeaf\.isSymbolicLink\(\) \|\| !dbLeaf\.isFile\(\) \|\| !dbStat\.isFile\(\)/);
  assert.match(source, /dbStat\.nlink !== 1 \|\| realpathSync\(dbPath\) !== dbPath/);
  assert.match(source, /PROGRAM_READINESS_DB_IDENTITY_INVALID/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
});

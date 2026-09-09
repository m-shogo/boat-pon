import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-h011-implied-vs-frequency-raw.ts", "utf8");

test("H011 raw analyzer cannot be invoked directly outside the settlement wrapper", () => {
  assert.match(source, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(source, /process\.argv\[1\]/);
  assert.match(source, /H011_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(source, /throw new Error\("H011_PRIMARY_DB_MISSING"\)/);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
  assert.match(source, /new DatabaseSync\(DB_PATH, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
});

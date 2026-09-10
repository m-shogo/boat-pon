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

  const identity = source.indexOf("const verifiedDbPath = assertCanonicalSingleLinkRegularFile(");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(identity >= 0, "H011 raw analyzer must verify canonical DB identity");
  assert.ok(open > identity, "H011 raw analyzer must open only the verified DB path");
  assert.match(source, /H011_RAW_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /PRAGMA query_only=ON/);
});

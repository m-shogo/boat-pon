import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync("scripts/analyze-roi-skip-policy-simulation-internal.ts", "utf-8");

test("ROI skip-policy internal verifies canonical DB identity before read-only query-only access", () => {
  const verify = source.search(/assertCanonicalSingleLinkRegularFile\(\s*DB_PATH,/);
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  const queryOnly = source.indexOf("PRAGMA query_only = ON", open);

  assert.ok(verify >= 0, "internal canonical DB identity validation must exist");
  assert.ok(open > verify, "internal DB must open only the verified canonical path");
  assert.ok(queryOnly > open, "query_only must be enabled after the read-only DB open");
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH/);
});

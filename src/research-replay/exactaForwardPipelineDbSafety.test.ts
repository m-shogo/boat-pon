import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/audit-exacta-forward-pipeline.ts", "utf8");

test("exacta forward audit verifies canonical DB identity before opening SQLite", () => {
  const identityIndex = source.indexOf("assertCanonicalSingleLinkRegularFile(");
  const openIndex = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(identityIndex >= 0, "canonical DB identity guard must exist");
  assert.ok(openIndex > identityIndex, "DB must only open after identity verification");
  assert.match(source, /PRAGMA query_only=ON/u);
});

test("exacta forward audit does not expose configured DB path in missing-file errors", () => {
  assert.match(source, /EXACTA_FORWARD_PIPELINE_DB_MISSING/u);
  assert.match(source, /EXACTA_FORWARD_PIPELINE_DB_IDENTITY_INVALID/u);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/u);
});

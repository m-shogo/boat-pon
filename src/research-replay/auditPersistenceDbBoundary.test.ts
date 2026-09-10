import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/check-audit-persistence.ts", "utf8");

test("audit persistence checker fails closed around the research DB boundary", () => {
  assert.doesNotMatch(source, /\$\{DB_PATH\} missing/);

  const missing = source.indexOf("primary research database missing");
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");

  assert.ok(missing >= 0, "missing DB diagnostics must remain opaque");
  assert.ok(identity >= 0, "canonical single-link regular-file identity must be checked");
  assert.ok(open > identity, "SQLite must only open the verified canonical path");
  assert.match(source, /AUDIT_PERSISTENCE_DB_IDENTITY_INVALID/);
  assert.match(source, /PRAGMA query_only = ON/);
});

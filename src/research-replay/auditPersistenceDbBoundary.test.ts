import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/check-audit-persistence.ts", "utf8");

test("audit persistence checker fails closed around the research DB boundary", () => {
  assert.doesNotMatch(source, /\$\{DB_PATH\} missing/);

  const missing = source.indexOf("primary research database missing");
  const identityCode = source.indexOf("AUDIT_PERSISTENCE_DB_IDENTITY_INVALID");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");

  assert.ok(missing >= 0, "missing DB diagnostics must remain opaque");
  assert.ok(identityCode >= 0, "canonical DB identity must be checked");
  assert.ok(open > identityCode, "SQLite must only open after the DB identity guard");
  assert.match(source, /assertCanonicalSingleLinkRegularFile\([\s\S]*DB_PATH,[\s\S]*AUDIT_PERSISTENCE_DB_IDENTITY_INVALID/);
  assert.match(source, /PRAGMA query_only = ON/);
});

test("audit persistence checker verifies server source identity before reading it", () => {
  const identityCode = source.indexOf("AUDIT_PERSISTENCE_SERVER_SOURCE_IDENTITY_INVALID");
  const read = source.indexOf("readFileSync(verifiedServerDbPath, \"utf8\")");

  assert.ok(identityCode >= 0, "server source must have an opaque identity failure code");
  assert.ok(read > identityCode, "server source must only be read after identity verification");
  assert.match(source, /assertCanonicalSingleLinkRegularFile\([\s\S]*SERVER_DB,[\s\S]*AUDIT_PERSISTENCE_SERVER_SOURCE_IDENTITY_INVALID/);
  assert.doesNotMatch(source, /readFileSync\(SERVER_DB/);
});

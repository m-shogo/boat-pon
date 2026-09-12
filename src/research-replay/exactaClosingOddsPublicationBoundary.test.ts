import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("exacta closing odds audit keeps the research database read-only", () => {
  const source = readFileSync("scripts/audit-exacta-closing-odds-availability.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(\s*DB_PATH,/u);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only = ON/u);
  assert.match(source, /EXACTA_CLOSING_ODDS_AUDIT_SETTLEMENT_INTEGRITY_INVALID/u);
  assert.match(source, /EXACTA_CLOSING_ODDS_AUDIT_SETTLEMENT_MISSING/u);
});

test("exacta closing odds reports use exclusive fsynced verified temp files and atomic rename", () => {
  const source = readFileSync("scripts/audit-exacta-closing-odds-availability.ts", "utf8");

  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(source, /writeFileSync\(fd, content, "utf-8"\);\s*fsyncSync\(fd\);/u);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)");
  const destinationGuard = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf(
    "assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)",
    destinationGuard,
  );
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);
  assert.ok(
    tempIdentity >= 0 &&
      destinationGuard > tempIdentity &&
      destinationIdentity > destinationGuard &&
      rename > destinationIdentity,
    "verified temp and any existing destination must be identity-checked before atomic replacement",
  );

  assert.match(source, /EXACTA_CLOSING_ODDS_AUDIT_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /EXACTA_CLOSING_ODDS_AUDIT_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /EXACTA_CLOSING_ODDS_AUDIT_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /EXACTA_CLOSING_ODDS_AUDIT_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /atomicPublishReport\(\s*OUT_MD,/u);
  assert.match(source, /atomicPublishReport\(\s*OUT_JSON,/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_(?:MD|JSON),/u);
});

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

test("exacta closing odds official cache verifies reads and publishes fetched bytes atomically", () => {
  const source = readFileSync("scripts/audit-exacta-closing-odds-availability.ts", "utf8");

  const cacheReadGuard = source.indexOf("if (existsSync(cp))");
  const cacheReadIdentity = source.indexOf(
    '"EXACTA_CLOSING_ODDS_AUDIT_CACHE_READ_IDENTITY_INVALID"',
    cacheReadGuard,
  );
  const cacheRead = source.indexOf('readFileSync(verifiedCachePath, "utf-8")', cacheReadIdentity);
  assert.ok(
    cacheReadGuard >= 0 && cacheReadIdentity > cacheReadGuard && cacheRead > cacheReadIdentity,
    "pre-existing official cache must be identity-checked before read",
  );

  const cacheTempIdentity = source.indexOf(
    '"EXACTA_CLOSING_ODDS_AUDIT_CACHE_TEMP_IDENTITY_INVALID"',
  );
  const cacheDestinationGuard = source.indexOf("if (existsSync(path))", cacheTempIdentity);
  const cacheDestinationIdentity = source.indexOf(
    '"EXACTA_CLOSING_ODDS_AUDIT_CACHE_DESTINATION_IDENTITY_INVALID"',
    cacheDestinationGuard,
  );
  const cacheExistingRead = source.indexOf(
    'readFileSync(verifiedExistingPath, "utf-8")',
    cacheDestinationIdentity,
  );
  const cacheRename = source.indexOf(
    "renameSync(verifiedTempPath, path)",
    cacheDestinationIdentity,
  );
  assert.ok(
    cacheTempIdentity >= 0 &&
      cacheDestinationGuard > cacheTempIdentity &&
      cacheDestinationIdentity > cacheDestinationGuard &&
      cacheExistingRead > cacheDestinationIdentity &&
      cacheRename > cacheExistingRead,
    "fetched cache temp must be verified and any concurrently existing destination preserved before atomic install",
  );

  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(source, /publishOfficialCache\(cp, html\)/u);
  assert.doesNotMatch(source, /writeFileSync\(cp, html/u);
});

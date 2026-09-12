import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/backfill-exacta-closing-odds.ts", "utf8");

test("exacta backfill validates DB identity and makes dry-run query-only", () => {
  const dbIdentity = source.indexOf('"EXACTA_CLOSING_ODDS_BACKFILL_DB_IDENTITY_INVALID"');
  const dbOpen = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: !WRITE_MODE })", dbIdentity);
  const queryOnly = source.indexOf('if (!WRITE_MODE) db.exec("PRAGMA query_only = ON;")', dbOpen);

  assert.ok(dbIdentity >= 0 && dbOpen > dbIdentity && queryOnly > dbOpen);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH,/u);
});

test("exacta backfill official cache verifies reads and publishes fetched bytes atomically", () => {
  const cacheGuard = source.indexOf("if (existsSync(cp))");
  const cacheIdentity = source.indexOf(
    '"EXACTA_CLOSING_ODDS_BACKFILL_CACHE_READ_IDENTITY_INVALID"',
    cacheGuard,
  );
  const cacheRead = source.indexOf('readFileSync(verifiedCachePath, "utf-8")', cacheIdentity);
  assert.ok(cacheGuard >= 0 && cacheIdentity > cacheGuard && cacheRead > cacheIdentity);

  const tempIdentity = source.indexOf(
    '"EXACTA_CLOSING_ODDS_BACKFILL_CACHE_TEMP_IDENTITY_INVALID"',
  );
  const destinationGuard = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf(
    '"EXACTA_CLOSING_ODDS_BACKFILL_CACHE_DESTINATION_IDENTITY_INVALID"',
    destinationGuard,
  );
  const existingRead = source.indexOf(
    'readFileSync(verifiedExistingPath, "utf-8")',
    destinationIdentity,
  );
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);
  assert.ok(
    tempIdentity >= 0 &&
      destinationGuard > tempIdentity &&
      destinationIdentity > destinationGuard &&
      existingRead > destinationIdentity &&
      rename > existingRead,
  );

  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(source, /publishOfficialCache\(cp, html\)/u);
  assert.doesNotMatch(source, /writeFileSync\(cp, html/u);
});

test("exacta backfill reports publish through verified atomic temp files", () => {
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
  );
  assert.match(source, /atomicPublishReport\(\s*OUT_MD,/u);
  assert.match(source, /atomicPublishReport\(\s*OUT_JSON,/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_(?:MD|JSON),/u);
});

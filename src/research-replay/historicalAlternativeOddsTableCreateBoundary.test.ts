import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/create-historical-alternative-odds-table.ts", "utf8");

test("historical alternative odds table creation verifies the database before write-open", () => {
  const dbIdentity = source.indexOf('"HISTORICAL_ALT_ODDS_TABLE_CREATE_DB_IDENTITY_INVALID"');
  const dbOpen = source.indexOf("new DatabaseSync(verifiedDbPath)", dbIdentity);

  assert.ok(dbIdentity >= 0 && dbOpen > dbIdentity);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH\)/u);
});

test("historical alternative odds table reports publish through verified atomic temp files", () => {
  const tempOpen = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)", tempOpen);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationGuard = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf(
    "assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)",
    destinationGuard,
  );
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);

  assert.ok(
    tempOpen >= 0 &&
      fsync > tempOpen &&
      tempIdentity > fsync &&
      destinationGuard > tempIdentity &&
      destinationIdentity > destinationGuard &&
      rename > destinationIdentity,
  );
  assert.match(source, /atomicPublishReport\(\s*OUT_MD,/u);
  assert.match(source, /atomicPublishReport\(\s*OUT_JSON,/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_(?:MD|JSON),/u);
});

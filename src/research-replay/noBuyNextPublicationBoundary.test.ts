import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-no-buy-next.ts", "utf8");

test("no-buy next analysis remains canonical read-only and query-only", () => {
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  const queryOnly = source.indexOf('db.exec("PRAGMA query_only = ON;")');
  const settlement = source.indexOf("assertOfficialWinningSettlements();");
  assert.ok(identity >= 0 && open > identity && queryOnly > open && settlement > queryOnly);
  assert.match(source, /returnSource: "official race_payouts"/);
});

test("no-buy next validates existing outputs and publishes atomically", () => {
  const preflightJson = source.indexOf("verifyExistingOutput(OUT_JSON");
  const preflightMd = source.indexOf("verifyExistingOutput(OUT_MD");
  const jsonPublish = source.indexOf("atomicPublish(OUT_JSON");
  const mdPublish = source.indexOf("atomicPublish(OUT_MD");
  assert.ok(preflightJson >= 0 && preflightMd > preflightJson && jsonPublish > preflightMd && mdPublish > jsonPublish);

  const create = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, identityErrorCode)", fsync);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", identity);
  assert.ok(create >= 0 && fsync > create && identity > fsync && rename > identity);

  assert.match(source, /NO_BUY_NEXT_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /NO_BUY_NEXT_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
});

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

test("no-buy next preflights the complete paired destination set before the first replacement", () => {
  const reportsIdentity = source.indexOf("NO_BUY_NEXT_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const preflightJson = source.indexOf("verifyExistingOutput(OUT_JSON", reportsIdentity);
  const preflightMd = source.indexOf("verifyExistingOutput(OUT_MD", preflightJson);
  const jsonPublish = source.indexOf("atomicPublish(", preflightMd);
  assert.ok(reportsIdentity >= 0 && preflightJson > reportsIdentity && preflightMd > preflightJson && jsonPublish > preflightMd);
  assert.match(source, /NO_BUY_NEXT_PREEXISTING_JSON_IDENTITY_INVALID/);
  assert.match(source, /NO_BUY_NEXT_PREEXISTING_MD_IDENTITY_INVALID/);
});

test("no-buy next publishes through verified atomic temp files with destination and parent handoff guards", () => {
  assert.match(source, /NO_BUY_NEXT_JSON_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /NO_BUY_NEXT_MD_PUBLISH_TEMP_IDENTITY_INVALID/);
  assert.match(source, /NO_BUY_NEXT_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/);
  assert.match(source, /NO_BUY_NEXT_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/);

  const helper = source.indexOf("function atomicPublish(");
  const parentIdentity = source.indexOf("NO_BUY_NEXT_PUBLISH_PARENT_IDENTITY_INVALID", helper);
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempIdentityErrorCode)", fsync);
  const destinationGuard = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf(
    "assertCanonicalSingleLinkRegularFile(path, destinationIdentityErrorCode)",
    destinationGuard,
  );
  const parentHandoff = source.indexOf("NO_BUY_NEXT_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);

  assert.ok(
    helper >= 0 &&
      parentIdentity > helper &&
      create > parentIdentity &&
      fsync > create &&
      tempIdentity > fsync &&
      destinationGuard > tempIdentity &&
      destinationIdentity > destinationGuard &&
      parentHandoff > destinationIdentity &&
      rename > parentHandoff,
  );
});

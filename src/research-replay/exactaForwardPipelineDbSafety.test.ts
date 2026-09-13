import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/audit-exacta-forward-pipeline.ts", "utf8");

test("exacta forward audit verifies canonical DB identity before opening SQLite", () => {
  const identityIndex = source.indexOf("EXACTA_FORWARD_PIPELINE_DB_IDENTITY_INVALID");
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

test("exacta forward audit verifies research source and candidate identities before reads", () => {
  for (const code of [
    "EXACTA_FORWARD_PIPELINE_AUTO_FETCH_SOURCE_IDENTITY_INVALID",
    "EXACTA_FORWARD_PIPELINE_H011_SOURCE_IDENTITY_INVALID",
    "EXACTA_FORWARD_PIPELINE_EXACTA_MONITOR_SOURCE_IDENTITY_INVALID",
    "EXACTA_FORWARD_PIPELINE_CANDIDATE_LOCK_IDENTITY_INVALID",
  ]) {
    assert.match(source, new RegExp(code));
  }

  assert.match(source, /readFileSync\(verifiedAutoFetchPath, "utf8"\)/u);
  assert.match(source, /readFileSync\(verifiedH011MonitorPath, "utf8"\)/u);
  assert.match(source, /readFileSync\(verifiedExactaMonitorPath, "utf8"\)/u);
  assert.match(source, /readFileSync\(verifiedLockPath, "utf8"\)/u);
  assert.doesNotMatch(source, /readFileSync\(LOCK_PATH/u);
  assert.doesNotMatch(source, /readFileSync\("scripts\/auto-fetch-odds\.ts"/u);
});

test("exacta forward audit preflights both report destinations before the first replacement", () => {
  const reportsIdentity = source.indexOf("EXACTA_FORWARD_PIPELINE_REPORTS_DIRECTORY_IDENTITY_INVALID");
  const completePreflight = source.indexOf("verifyExistingReports();", reportsIdentity);
  const jsonPublish = source.indexOf("writeAtomicReport(OUT_JSON", completePreflight);
  const mdPublish = source.indexOf("writeAtomicReport(OUT_MD", jsonPublish);

  assert.ok(reportsIdentity >= 0);
  assert.ok(completePreflight > reportsIdentity);
  assert.ok(jsonPublish > completePreflight);
  assert.ok(mdPublish > jsonPublish);
  assert.match(source, /EXACTA_FORWARD_PIPELINE_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /EXACTA_FORWARD_PIPELINE_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID/u);
});

test("exacta forward audit publishes reports through verified atomic temp files and parent handoff", () => {
  const parentIdentity = source.indexOf("EXACTA_FORWARD_PIPELINE_REPORT_PARENT_IDENTITY_INVALID");
  const tempCreate = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", tempCreate);
  const tempIdentity = source.indexOf("EXACTA_FORWARD_PIPELINE_REPORT_TEMP_IDENTITY_INVALID", fsync);
  const destinationIdentity = source.lastIndexOf("EXACTA_FORWARD_PIPELINE_REPORT_TARGET_IDENTITY_INVALID");
  const parentHandoff = source.indexOf("EXACTA_FORWARD_PIPELINE_REPORT_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = source.indexOf("renameSync(tempPath, path)", parentHandoff);

  assert.match(source, /EXACTA_FORWARD_PIPELINE_REPORT_TARGET_IDENTITY_INVALID/u);
  assert.ok(parentIdentity >= 0, "canonical report parent must be verified before temp creation");
  assert.ok(tempCreate > parentIdentity, "report publication must use an exclusive temp file after parent verification");
  assert.ok(fsync > tempCreate, "report temp file must be fsynced");
  assert.ok(tempIdentity > fsync, "temp identity must be checked after durable write");
  assert.ok(destinationIdentity > tempIdentity, "existing destination must be revalidated after temp identity");
  assert.ok(parentHandoff > destinationIdentity, "parent must be revalidated after destination identity");
  assert.ok(rename > parentHandoff, "atomic rename must follow parent handoff verification");
  assert.match(source, /!stat\.isDirectory\(\) \|\| stat\.isSymbolicLink\(\)/u);
  assert.match(source, /realpathSync\(path\) !== resolvedPath/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_(?:JSON|MD)/u);
});
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-racer-data-freshness.ts", "utf8");

test("racer freshness keeps the research database read-only", () => {
  const identity = source.indexOf('"RACER_FRESHNESS_DB_IDENTITY_INVALID"');
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  const queryOnly = source.indexOf('db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000")');

  assert.ok(identity >= 0, "DB identity guard must exist");
  assert.ok(open > identity, "DB must open only after canonical identity verification");
  assert.ok(queryOnly > open, "query_only must remain downstream of read-only DB open");
});

test("racer freshness preflights the complete paired destination set before the first publication", () => {
  const reportsIdentity = source.indexOf('"RACER_FRESHNESS_REPORTS_DIRECTORY_IDENTITY_INVALID"');
  const mdPreflight = source.indexOf('verifyExistingOutput(REPORT_MD, "RACER_FRESHNESS_PREEXISTING_MD_IDENTITY_INVALID")');
  const jsonPreflight = source.indexOf('verifyExistingOutput(REPORT_JSON, "RACER_FRESHNESS_PREEXISTING_JSON_IDENTITY_INVALID")');
  const firstPublish = source.indexOf("atomicPublish(\n  REPORT_MD,");

  assert.ok(reportsIdentity >= 0, "canonical reports directory guard must exist");
  assert.ok(mdPreflight > reportsIdentity, "Markdown destination must be preflighted after parent identity");
  assert.ok(jsonPreflight > mdPreflight, "JSON destination must be preflighted before any publication");
  assert.ok(firstPublish > jsonPreflight, "no paired output may publish before both destinations pass preflight");
});

test("racer freshness revalidates the publication parent and destination immediately before atomic replacement", () => {
  const helperStart = source.indexOf("function atomicPublish(");
  const parentIdentity = source.indexOf('"RACER_FRESHNESS_PUBLISH_PARENT_IDENTITY_INVALID"', helperStart);
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempIdentityErrorCode)", fsync);
  const destinationIdentity = source.indexOf("verifyExistingOutput(path, destinationIdentityErrorCode)", tempIdentity);
  const parentHandoff = source.indexOf('"RACER_FRESHNESS_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID"', destinationIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);

  assert.ok(parentIdentity >= 0 && create > parentIdentity, "temp creation must follow canonical parent verification");
  assert.ok(fsync > create && tempIdentity > fsync, "temp publication must remain exclusive, durable, and identity-checked");
  assert.ok(destinationIdentity > tempIdentity, "destination must be revalidated after the staged temp is durable");
  assert.ok(parentHandoff > destinationIdentity, "parent handoff must be revalidated after destination identity");
  assert.ok(rename > parentHandoff, "atomic rename must be the final filesystem step after all handoff checks");
});

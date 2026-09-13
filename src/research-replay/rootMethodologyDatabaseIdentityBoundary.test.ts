import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("root methodology internal verifies primary database identity before opening read-only", () => {
  const source = readFileSync("scripts/audit-root-methodology-internal.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /ROOT_METHODOLOGY_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH/);
});

test("root methodology guarded entrypoint reverifies DB identity after cohort preflight and before isolated child launch", () => {
  const source = readFileSync("scripts/audit-root-methodology.ts", "utf8");
  const primaryIdentity = source.indexOf("ROOT_METHODOLOGY_PRIMARY_DB_IDENTITY_INVALID");
  const cohortGate = source.indexOf("ROOT_METHODOLOGY_FORWARD_COHORT_INVALID");
  const close = source.lastIndexOf("db.close()");
  const handoffIdentity = source.indexOf("ROOT_METHODOLOGY_DB_HANDOFF_IDENTITY_INVALID");
  const childIdentity = source.indexOf("ROOT_METHODOLOGY_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const childLaunch = source.indexOf("const audit = spawnSync");

  assert.ok(primaryIdentity >= 0);
  assert.ok(cohortGate > primaryIdentity);
  assert.ok(close > cohortGate);
  assert.ok(handoffIdentity > close, "handoff identity must be checked after the preflight DB closes");
  assert.ok(childIdentity > handoffIdentity, "child-launch identity must revalidate the preflight handoff");
  assert.ok(childLaunch > childIdentity, "internal audit must start only after launch identity revalidation");
  assert.match(source, /env: \{ \.\.\.process\.env, BOAT_PON_DB_PATH: launchDbPath \}/u);
  assert.doesNotMatch(source, /await import\("\.\/audit-root-methodology-internal"\)/u);
});

test("root methodology validates the complete destination set before paired publication", () => {
  const source = readFileSync("scripts/audit-root-methodology.ts", "utf8");
  const markdownRead = source.indexOf('readFileSync(verifiedMarkdownPath, "utf8")');
  const publishMkdir = source.indexOf('mkdirSync("reports", { recursive: true })', markdownRead);
  const reportsIdentity = source.indexOf("ROOT_METHODOLOGY_REPORTS_DIRECTORY_IDENTITY_INVALID", publishMkdir);
  const jsonPrepublish = source.indexOf("ROOT_METHODOLOGY_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID", reportsIdentity);
  const markdownPrepublish = source.indexOf("ROOT_METHODOLOGY_MARKDOWN_PREPUBLISH_DESTINATION_IDENTITY_INVALID", jsonPrepublish);
  const firstPublish = source.indexOf("atomicPublish(", markdownPrepublish);

  assert.match(source, /mkdtempSync\(join\(tmpdir\(\), "boat-pon-root-methodology-"\)\)/u);
  assert.match(source, /ROOT_METHODOLOGY_JSON_OUTPUT_IDENTITY_INVALID/u);
  assert.match(source, /ROOT_METHODOLOGY_MARKDOWN_OUTPUT_IDENTITY_INVALID/u);
  assert.ok(publishMkdir > markdownRead);
  assert.ok(reportsIdentity > publishMkdir);
  assert.ok(jsonPrepublish > reportsIdentity && markdownPrepublish > jsonPrepublish);
  assert.ok(firstPublish > markdownPrepublish, "both canonical destinations must be preflighted before the first replacement");
  assert.match(source, /atomicPublish\(\s*OUT_JSON,\s*json,/u);
  assert.match(source, /atomicPublish\(\s*OUT_MD,\s*markdown,/u);
  assert.match(source, /rmSync\(workspace, \{ recursive: true, force: true \}\)/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_(?:JSON|MD)/u);
});

test("root methodology atomic publication reverifies parent and destination identities at handoff", () => {
  const source = readFileSync("scripts/audit-root-methodology.ts", "utf8");
  const atomic = source.indexOf("function atomicPublish");
  const parentIdentity = source.indexOf("ROOT_METHODOLOGY_PUBLISH_PARENT_IDENTITY_INVALID", atomic);
  const exclusiveOpen = source.indexOf('openSync(tempPath, "wx", 0o600)', parentIdentity);
  const fsync = source.indexOf("fsyncSync(fd)", exclusiveOpen);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationExistence = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)", destinationExistence);
  const parentHandoff = source.indexOf("ROOT_METHODOLOGY_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);

  assert.ok(parentIdentity > atomic);
  assert.ok(exclusiveOpen > parentIdentity && fsync > exclusiveOpen);
  assert.ok(tempIdentity > fsync);
  assert.ok(destinationExistence > tempIdentity && destinationIdentity > destinationExistence);
  assert.ok(parentHandoff > destinationIdentity);
  assert.ok(rename > parentHandoff, "atomic rename must occur only after parent and destination identity revalidation");
  assert.match(source, /ROOT_METHODOLOGY_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /ROOT_METHODOLOGY_MARKDOWN_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /writeFileSync\(fd, contents, "utf8"\);\s*fsyncSync\(fd\);/u);
});

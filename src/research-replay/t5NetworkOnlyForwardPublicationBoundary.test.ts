import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/audit-t5-network-only-forward.ts", "utf8");

test("T-5 network-only forward atomically publishes identity-checked reports", () => {
  const helperStart = source.indexOf("function atomicPublish(");
  const publishStart = source.indexOf('mkdirSync("reports"', helperStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(publishStart, -1);
  const helper = source.slice(helperStart, publishStart);

  const parentIdentity = helper.indexOf('assertCanonicalDirectory(parentPath, "T5_NETWORK_ONLY_FORWARD_PUBLISH_PARENT_IDENTITY_INVALID")');
  const open = helper.indexOf('openSync(tempPath, "wx", 0o600)');
  const write = helper.indexOf('writeFileSync(fd, contents, "utf8")');
  const fsync = helper.indexOf("fsyncSync(fd)");
  const tempIdentity = helper.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)");
  const destinationIdentity = helper.indexOf("verifyExistingDestination(path, destinationErrorCode)");
  const parentHandoff = helper.indexOf('assertCanonicalDirectory(parentPath, "T5_NETWORK_ONLY_FORWARD_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID")');
  const rename = helper.indexOf("renameSync(verifiedTempPath, path)");

  assert.ok(parentIdentity >= 0);
  assert.ok(parentIdentity < open);
  assert.ok(open < write);
  assert.ok(write < fsync);
  assert.ok(fsync < tempIdentity);
  assert.ok(tempIdentity < destinationIdentity);
  assert.ok(destinationIdentity < parentHandoff);
  assert.ok(parentHandoff < rename);
});

test("T-5 network-only forward preflights the complete destination set before first replacement", () => {
  const publishStart = source.indexOf('mkdirSync("reports"');
  assert.notEqual(publishStart, -1);
  const publication = source.slice(publishStart);

  const reportsIdentity = publication.indexOf('assertCanonicalDirectory("reports", "T5_NETWORK_ONLY_FORWARD_REPORTS_DIRECTORY_IDENTITY_INVALID")');
  const jsonPreflight = publication.indexOf('verifyExistingDestination(OUT_JSON, "T5_NETWORK_ONLY_FORWARD_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID")');
  const mdPreflight = publication.indexOf('verifyExistingDestination(OUT_MD, "T5_NETWORK_ONLY_FORWARD_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID")');
  const jsonPublish = publication.indexOf("atomicPublish(\n  OUT_JSON,");
  const mdPublish = publication.indexOf("atomicPublish(\n  OUT_MD,");

  assert.ok(reportsIdentity >= 0);
  assert.ok(reportsIdentity < jsonPreflight);
  assert.ok(jsonPreflight < mdPreflight);
  assert.ok(mdPreflight < jsonPublish);
  assert.ok(jsonPublish < mdPublish);
});

test("T-5 network-only forward does not write canonical report destinations directly", () => {
  assert.match(source, /atomicPublish\(\s*OUT_JSON,/u);
  assert.match(source, /atomicPublish\(\s*OUT_MD,/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD/u);
});

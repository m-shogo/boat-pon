import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-t5-residual-forward.ts", "utf8");

test("T-5 residual forward preflights both canonical destinations before the first publication", () => {
  const reportsIdentity = source.indexOf('assertCanonicalDirectory("reports","T5_RESIDUAL_FORWARD_REPORTS_DIRECTORY_IDENTITY_INVALID")');
  const jsonPreflight = source.indexOf('verifyExistingDestination(OUT_JSON,"T5_RESIDUAL_FORWARD_JSON_PREPUBLISH_DESTINATION_IDENTITY_INVALID")', reportsIdentity);
  const mdPreflight = source.indexOf('verifyExistingDestination(OUT_MD,"T5_RESIDUAL_FORWARD_MD_PREPUBLISH_DESTINATION_IDENTITY_INVALID")', jsonPreflight);
  const firstPublish = source.indexOf("atomicPublish(OUT_JSON", mdPreflight);

  assert.ok(reportsIdentity >= 0);
  assert.ok(jsonPreflight > reportsIdentity);
  assert.ok(mdPreflight > jsonPreflight);
  assert.ok(firstPublish > mdPreflight);
});

test("T-5 residual forward publishes reports through an atomic identity-checked parent handoff", () => {
  const helperStart = source.indexOf("function atomicPublish(");
  const publishStart = source.indexOf('mkdirSync("reports"', helperStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(publishStart, -1);
  const helper = source.slice(helperStart, publishStart);

  const parentIdentity = helper.indexOf("T5_RESIDUAL_FORWARD_PUBLISH_PARENT_IDENTITY_INVALID");
  const open = helper.indexOf('openSync(tempPath,"wx",0o600)');
  const write = helper.indexOf('writeFileSync(fd,contents,"utf8")');
  const fsync = helper.indexOf("fsyncSync(fd)");
  const tempIdentity = helper.indexOf("assertCanonicalSingleLinkRegularFile(tempPath,tempErrorCode)");
  const destinationIdentity = helper.indexOf("verifyExistingDestination(path,destinationErrorCode)");
  const parentHandoff = helper.indexOf("T5_RESIDUAL_FORWARD_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID");
  const rename = helper.indexOf("renameSync(verifiedTempPath,path)");

  assert.ok(parentIdentity >= 0);
  assert.ok(parentIdentity < open);
  assert.ok(open < write);
  assert.ok(write < fsync);
  assert.ok(fsync < tempIdentity);
  assert.ok(tempIdentity < destinationIdentity);
  assert.ok(destinationIdentity < parentHandoff);
  assert.ok(parentHandoff < rename);
});

test("T-5 residual forward report outputs use the atomic publisher instead of direct destination writes", () => {
  assert.match(source, /atomicPublish\(OUT_JSON,/u);
  assert.match(source, /atomicPublish\(OUT_MD,/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD/u);
});

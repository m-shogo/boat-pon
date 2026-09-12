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

  const open = helper.indexOf('openSync(tempPath, "wx", 0o600)');
  const write = helper.indexOf('writeFileSync(fd, contents, "utf8")');
  const fsync = helper.indexOf("fsyncSync(fd)");
  const tempIdentity = helper.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)");
  const destinationIdentity = helper.indexOf("if (existsSync(path)) assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)");
  const rename = helper.indexOf("renameSync(verifiedTempPath, path)");

  assert.ok(open >= 0);
  assert.ok(open < write);
  assert.ok(write < fsync);
  assert.ok(fsync < tempIdentity);
  assert.ok(tempIdentity < destinationIdentity);
  assert.ok(destinationIdentity < rename);
});

test("T-5 network-only forward does not write canonical report destinations directly", () => {
  assert.match(source, /atomicPublish\(\s*OUT_JSON,/u);
  assert.match(source, /atomicPublish\(\s*OUT_MD,/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_JSON/u);
  assert.doesNotMatch(source, /writeFileSync\(OUT_MD/u);
});

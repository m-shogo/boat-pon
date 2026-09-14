import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/research/governance/registryStore.ts", "utf8");

test("append-only registry publication verifies its parent before temp creation and again before hard-link publish", () => {
  const atomicStart = source.indexOf("function atomicCreateUtf8(");
  const atomicEnd = source.indexOf("export type AppendResult", atomicStart);
  assert.ok(atomicStart >= 0 && atomicEnd > atomicStart);

  const atomic = source.slice(atomicStart, atomicEnd);
  const mkdir = atomic.indexOf("mkdirSync(dirname(path), { recursive: true })");
  const firstParentCheck = atomic.indexOf("assertRegistryPublicationParentSafe(path)");
  const tempOpen = atomic.indexOf('openSync(temp, "wx"');
  const fsync = atomic.indexOf("fsyncSync(fd)");
  const secondParentCheck = atomic.indexOf("assertRegistryPublicationParentSafe(path)", firstParentCheck + 1);
  const publish = atomic.indexOf("linkSync(temp, path)");

  assert.ok(mkdir >= 0, "registry publication must create its parent before validating it");
  assert.ok(firstParentCheck > mkdir, "registry publication parent must be verified after mkdir");
  assert.ok(tempOpen > firstParentCheck, "temp creation must happen only after parent verification");
  assert.ok(fsync > tempOpen, "registry temp must be durable before publication handoff");
  assert.ok(secondParentCheck > fsync, "registry publication parent must be rechecked after durable temp creation");
  assert.ok(publish > secondParentCheck, "append-only hard-link publication must happen only after parent handoff verification");
});

test("registry publication parent rejects missing, symlink, and non-directory containers", () => {
  const guardStart = source.indexOf("function assertRegistryPublicationParentSafe(");
  const guardEnd = source.indexOf("function readRegistryRecordUtf8(", guardStart);
  assert.ok(guardStart >= 0 && guardEnd > guardStart);

  const guard = source.slice(guardStart, guardEnd);
  assert.match(guard, /assertRegistryAncestorsSafe\(parent\)/u);
  assert.match(guard, /!stat \|\| stat\.isSymbolicLink\(\) \|\| !stat\.isDirectory\(\)/u);
  assert.match(guard, /registry publication parent invalid/u);
});

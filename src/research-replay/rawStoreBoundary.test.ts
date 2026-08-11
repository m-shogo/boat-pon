import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "src/research-replay/rawStore.ts"), "utf8");

test("raw store publishes content-addressed blobs with no-replace semantics", () => {
  assert.match(source, /linkSync\(tempPath, absolutePath\)/u);
  assert.match(source, /error\.code === "EEXIST"/u);
  assert.match(source, /unlinkSync\(tempPath\)/u);
  assert.doesNotMatch(source, /renameSync\(tempPath, absolutePath\)/u);
});

test("raw store reads through an O_NOFOLLOW file descriptor", () => {
  assert.match(source, /openSync\(path, fsConstants\.O_RDONLY \| fsConstants\.O_NOFOLLOW\)/u);
  assert.match(source, /const stat = fstatSync\(fd\)/u);
  assert.match(source, /if \(!stat\.isFile\(\)\) throw new Error\("raw file type rejected"\)/u);
  assert.match(source, /return readFileSync\(fd\)/u);
  assert.match(source, /const existing = readRawFileNoFollow\(absolutePath\)/u);
  assert.match(source, /const bytes = readRawFileNoFollow\(absolutePath\)/u);
});

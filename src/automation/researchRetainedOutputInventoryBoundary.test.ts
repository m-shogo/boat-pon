import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "src/automation/researchRetainedOutputInventory.ts"), "utf8");

test("retained inventory binds hashing reads to a bounded nonblocking validated file descriptor", () => {
  assert.match(source, /openSync\(path, fsConstants\.O_RDONLY \| fsConstants\.O_NOFOLLOW \| fsConstants\.O_NONBLOCK\)/u);
  assert.match(source, /const stat = fstatSync\(fd\)/u);
  assert.match(source, /stat\.dev !== expectedStat\.dev/u);
  assert.match(source, /stat\.ino !== expectedStat\.ino/u);
  assert.match(source, /stat\.size !== expectedStat\.size/u);
  assert.match(source, /stat\.size > MAX_RETAINED_FILE_BYTES/u);
  assert.match(source, /readSync\(fd/u);
  assert.match(source, /remainingWithSentinel/u);
  assert.match(source, /totalBytes > expectedStat\.size/u);
  assert.match(source, /totalBytes !== expectedStat\.size/u);
  assert.match(source, /closeSync\(fd\)/u);
  assert.doesNotMatch(source, /readFileSync\(fd\)/u);
  assert.doesNotMatch(source, /const content = readFileSync\(absolutePath\)/u);
});

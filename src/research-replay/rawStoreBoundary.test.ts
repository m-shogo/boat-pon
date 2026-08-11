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

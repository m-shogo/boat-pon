import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/create-review-log.ts", "utf8");

test("review log publication verifies inputs and publishes atomically", () => {
  assert.match(
    source,
    /assertCanonicalSingleLinkRegularFile\([\s\S]*?TEMPLATE_PATH/u,
  );
  assert.match(
    source,
    /assertCanonicalSingleLinkRegularFile\([\s\S]*?review log output/u,
  );
  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(
    source,
    /writeFileSync\(fd, content, "utf8"\);\s*fsyncSync\(fd\);/u,
  );
  assert.match(
    source,
    /assertCanonicalSingleLinkRegularFile\([\s\S]*?tempPath[\s\S]*?renameSync\(verifiedTempPath, path\)/u,
  );
  assert.doesNotMatch(source, /writeFileSync\(outPath/u);
});

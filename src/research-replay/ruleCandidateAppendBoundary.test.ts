import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/append-rule-candidates.ts", "utf8");

test("rule candidate append is identity-checked, idempotent, and atomically published", () => {
  assert.match(
    source,
    /assertCanonicalSingleLinkRegularFile\([\s\S]*?args\.input/u,
  );
  assert.match(
    source,
    /assertCanonicalSingleLinkRegularFile\([\s\S]*?args\.output/u,
  );
  assert.match(source, /createHash\("sha256"\)/u);
  assert.match(source, /boat-pon-rule-candidate:\$\{appendId\}/u);
  assert.match(source, /if \(current\.includes\(marker\)\)/u);
  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(
    source,
    /writeFileSync\(fd, content, "utf-8"\);\s*fsyncSync\(fd\);/u,
  );
  assert.match(
    source,
    /assertCanonicalSingleLinkRegularFile\([\s\S]*?tempPath[\s\S]*?renameSync\(verifiedTempPath, path\)/u,
  );
  assert.doesNotMatch(
    source,
    /writeFileSync\(args\.output/u,
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCE_URL = new URL("./researchDurableKnowledgeLegacyCompatibility.ts", import.meta.url);

test("legacy output byte metadata stays bound to the validated read", () => {
  const source = readFileSync(SOURCE_URL, "utf8");
  assert.match(source, /bytes: Buffer\.byteLength\(text, "utf8"\)/u);
  assert.doesNotMatch(
    source,
    /const statPath = resolveInside\(repoRoot, LEGACY_V0_OUTPUT_PATH\)/u,
  );
});

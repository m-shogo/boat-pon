import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./n2T5DecisionCutoffMetadata.ts", import.meta.url), "utf8");

test("private metadata reads use the trusted descriptor-bound reader", () => {
  assert.match(source, /readGovernanceFileUtf8Bounded\(path, maxBytes, trustedRoot\)/);
  assert.doesNotMatch(source, /readFileSync\(path/);
  assert.doesNotMatch(source, /statSync\(path/);
  assert.match(source, /throw new Error\("PRIVATE_METADATA_READ_INVALID"\)/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-research-governor.ts", "utf8");

test("research governor stages canonical inputs through descriptor-bound governance reads", () => {
  assert.match(
    source,
    /import \{ readGovernanceFileUtf8 \} from "\.\.\/src\/research\/governance\/safeFs";/u,
  );

  const stageStart = source.indexOf("function stageVerifiedInput(");
  const stageEnd = source.indexOf("function atomicPublish(", stageStart);
  assert.ok(stageStart >= 0 && stageEnd > stageStart);
  const stage = source.slice(stageStart, stageEnd);

  const read = stage.indexOf("readGovernanceFileUtf8(sourcePath, process.cwd())");
  const write = stage.indexOf("writeExclusive(");
  assert.ok(read >= 0, "staged governor inputs must bind reads to a validated file descriptor");
  assert.ok(write > read, "staged content must be read safely before the isolated copy is published");
  assert.doesNotMatch(stage, /readFileSync\(/u);
  assert.doesNotMatch(stage, /assertCanonicalSingleLinkRegularFile\(sourcePath/u);
  assert.match(stage, /catch \{\s*throw new Error\(errorCode\);\s*\}/u);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("legacy request runner does not substitute local HEAD when origin refresh fails", () => {
  const source = readFileSync(resolve(process.cwd(), "scripts/run-research-task.ts"), "utf8");
  const originGuard = source.match(/originHeadSha:\s*\(\(\) => \{[^\n]+\}\)\(\)/)?.[0] ?? "";

  assert.match(originGuard, /git\("fetch", "origin", "--quiet"\)/);
  assert.match(originGuard, /catch \{ return ""; \}/);
  assert.doesNotMatch(originGuard, /catch \{ return git\("rev-parse", "HEAD"\); \}/);
});

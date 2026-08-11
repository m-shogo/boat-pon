import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const script = readFileSync(resolve(process.cwd(), "scripts/automation-commit.sh"), "utf8");

test("automation commit pins Git top-level to the helper startup physical cwd before reading changes", () => {
  const startupRoot = script.indexOf('START_REPO_ROOT="$(pwd -P)"');
  const topLevel = script.indexOf('GIT_TOP_LEVEL="$(git_no_hooks rev-parse --show-toplevel)"');
  const physicalTopLevel = script.indexOf('GIT_TOP_LEVEL_PHYSICAL="$(cd "$GIT_TOP_LEVEL" && pwd -P)"');
  const identityGuard = script.indexOf('if [ "$GIT_TOP_LEVEL_PHYSICAL" != "$START_REPO_ROOT" ]; then');
  const statusRead = script.indexOf("git_no_hooks status --porcelain -uall");

  assert.notEqual(startupRoot, -1);
  assert.notEqual(topLevel, -1);
  assert.notEqual(physicalTopLevel, -1);
  assert.notEqual(identityGuard, -1);
  assert.notEqual(statusRead, -1);
  assert.ok(startupRoot < topLevel);
  assert.ok(topLevel < physicalTopLevel);
  assert.ok(physicalTopLevel < identityGuard);
  assert.ok(identityGuard < statusRead);
  assert.match(script, /git top-level escaped trusted physical cwd; refusing untrusted worktree identity/u);
  assert.match(script, /cd "\$START_REPO_ROOT"\nREPO_ROOT="\$START_REPO_ROOT"/u);
  assert.doesNotMatch(script, /cd "\$\(git_no_hooks rev-parse --show-toplevel\)"/u);
});

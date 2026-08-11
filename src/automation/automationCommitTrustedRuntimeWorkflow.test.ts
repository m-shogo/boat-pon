import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/boat-pon-intent-dispatch.yml"),
  "utf8",
);

test("intent workflow captures trusted git/node paths before task execution", () => {
  const gitCapture = workflow.indexOf('TRUSTED_GIT_BIN="$(command -v git)"');
  const nodeCapture = workflow.indexOf('TRUSTED_NODE_BIN="$(command -v node)"');
  const task = workflow.indexOf("- name: Run exactly one task");
  assert.notEqual(gitCapture, -1);
  assert.notEqual(nodeCapture, -1);
  assert.notEqual(task, -1);
  assert.ok(gitCapture < task);
  assert.ok(nodeCapture < task);
  assert.match(workflow, /trusted_git_bin=\$TRUSTED_GIT_BIN/u);
  assert.match(workflow, /trusted_node_bin=\$TRUSTED_NODE_BIN/u);
});

test("post-task restore and token-bearing commit neutralize startup and PATH injection", () => {
  const restore = workflow.slice(workflow.indexOf("- name: Restore trusted automation commit helpers"));
  const commit = restore.slice(restore.indexOf("- name: Commit control state + results to automation branch"));

  assert.match(restore, /BASH_ENV: \/dev\/null/u);
  assert.match(restore, /ENV: \/dev\/null/u);
  assert.match(restore, /PATH: \/usr\/bin:\/bin:\/usr\/sbin:\/sbin/u);
  assert.match(restore, /TRUSTED_GIT_BIN: \$\{\{ steps\.materialize_authority\.outputs\.trusted_git_bin \}\}/u);
  assert.match(restore, /"\$TRUSTED_GIT_BIN" -c core\.hooksPath=\/dev\/null/u);

  assert.match(commit, /BASH_ENV: \/dev\/null/u);
  assert.match(commit, /NODE_OPTIONS: ""/u);
  assert.match(commit, /NODE_PATH: ""/u);
  assert.match(commit, /PATH: \/usr\/bin:\/bin:\/usr\/sbin:\/sbin/u);
  assert.match(commit, /TRUSTED_NODE_BIN: \$\{\{ steps\.materialize_authority\.outputs\.trusted_node_bin \}\}/u);
  assert.match(commit, /BOAT_PON_AUTOMATION_PUSH_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.match(commit, /run: \/bin\/bash scripts\/automation-commit\.sh/u);
});

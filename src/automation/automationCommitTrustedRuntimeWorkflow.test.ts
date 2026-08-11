import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/boat-pon-intent-dispatch.yml"),
  "utf8",
);

test("intent workflow captures trusted git/node identities before task execution", () => {
  const gitCapture = workflow.indexOf('TRUSTED_GIT_BIN="$(command -v git)"');
  const nodeCapture = workflow.indexOf('TRUSTED_NODE_BIN="$(command -v node)"');
  const gitDigest = workflow.indexOf('TRUSTED_GIT_SHA256="$(/usr/bin/shasum -a 256');
  const nodeDigest = workflow.indexOf('TRUSTED_NODE_SHA256="$(/usr/bin/shasum -a 256');
  const task = workflow.indexOf("- name: Run exactly one task");
  assert.notEqual(gitCapture, -1);
  assert.notEqual(nodeCapture, -1);
  assert.notEqual(gitDigest, -1);
  assert.notEqual(nodeDigest, -1);
  assert.notEqual(task, -1);
  assert.ok(gitCapture < task);
  assert.ok(nodeCapture < task);
  assert.ok(gitDigest < task);
  assert.ok(nodeDigest < task);
  assert.match(workflow, /trusted_git_bin=\$TRUSTED_GIT_BIN/u);
  assert.match(workflow, /trusted_node_bin=\$TRUSTED_NODE_BIN/u);
  assert.match(workflow, /trusted_git_sha256=\$TRUSTED_GIT_SHA256/u);
  assert.match(workflow, /trusted_node_sha256=\$TRUSTED_NODE_SHA256/u);
});

test("post-task restore and token-bearing commit neutralize startup, PATH and binary replacement", () => {
  const restore = workflow.slice(workflow.indexOf("- name: Restore trusted automation commit helpers"));
  const commit = restore.slice(restore.indexOf("- name: Commit control state + results to automation branch"));

  assert.match(restore, /BASH_ENV: \/dev\/null/u);
  assert.match(restore, /ENV: \/dev\/null/u);
  assert.match(restore, /PERL5OPT: ""/u);
  assert.match(restore, /PATH: \/usr\/bin:\/bin:\/usr\/sbin:\/sbin/u);
  assert.match(restore, /TRUSTED_GIT_BIN: \$\{\{ steps\.materialize_authority\.outputs\.trusted_git_bin \}\}/u);
  assert.match(restore, /TRUSTED_GIT_SHA256: \$\{\{ steps\.materialize_authority\.outputs\.trusted_git_sha256 \}\}/u);
  assert.match(restore, /CURRENT_GIT_SHA256=/u);
  assert.match(restore, /"\$TRUSTED_GIT_BIN" -c core\.hooksPath=\/dev\/null/u);

  assert.match(commit, /BASH_ENV: \/dev\/null/u);
  assert.match(commit, /NODE_OPTIONS: ""/u);
  assert.match(commit, /NODE_PATH: ""/u);
  assert.match(commit, /PATH: \/usr\/bin:\/bin:\/usr\/sbin:\/sbin/u);
  assert.match(commit, /TRUSTED_NODE_BIN: \$\{\{ steps\.materialize_authority\.outputs\.trusted_node_bin \}\}/u);
  assert.match(commit, /TRUSTED_NODE_SHA256: \$\{\{ steps\.materialize_authority\.outputs\.trusted_node_sha256 \}\}/u);
  assert.match(commit, /CURRENT_NODE_SHA256=/u);
  assert.match(commit, /BOAT_PON_AUTOMATION_PUSH_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.match(commit, /exec \/bin\/bash scripts\/automation-commit\.sh/u);
});
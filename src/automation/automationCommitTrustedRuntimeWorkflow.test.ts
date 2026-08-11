import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/boat-pon-intent-dispatch.yml"),
  "utf8",
);

test("intent workflow captures trusted git/node identities and helper bytes before task execution", () => {
  const gitCapture = workflow.indexOf('TRUSTED_GIT_BIN="$(command -v git)"');
  const nodeCapture = workflow.indexOf('TRUSTED_NODE_BIN="$(command -v node)"');
  const gitDigest = workflow.indexOf('TRUSTED_GIT_SHA256="$(/usr/bin/shasum -a 256');
  const nodeDigest = workflow.indexOf('TRUSTED_NODE_SHA256="$(/usr/bin/shasum -a 256');
  const helperCapture = workflow.indexOf('capture_helper "commit_script" "scripts/automation-commit.sh"');
  const helperBytesOutput = workflow.indexOf('echo "${key}_b64=$encoded" >> "$GITHUB_OUTPUT"');
  const task = workflow.indexOf("- name: Run exactly one task");
  assert.notEqual(gitCapture, -1);
  assert.notEqual(nodeCapture, -1);
  assert.notEqual(gitDigest, -1);
  assert.notEqual(nodeDigest, -1);
  assert.notEqual(helperCapture, -1);
  assert.notEqual(helperBytesOutput, -1);
  assert.notEqual(task, -1);
  assert.ok(gitCapture < task);
  assert.ok(nodeCapture < task);
  assert.ok(gitDigest < task);
  assert.ok(nodeDigest < task);
  assert.ok(helperCapture < task);
  assert.ok(helperBytesOutput < task);
  assert.match(workflow, /trusted_git_bin=\$TRUSTED_GIT_BIN/u);
  assert.match(workflow, /trusted_node_bin=\$TRUSTED_NODE_BIN/u);
  assert.match(workflow, /trusted_git_sha256=\$TRUSTED_GIT_SHA256/u);
  assert.match(workflow, /trusted_node_sha256=\$TRUSTED_NODE_SHA256/u);
  assert.match(workflow, /capture_helper "retained_gate_mjs" "scripts\/check-research-retained-output-commit\.mjs"/u);
  assert.match(workflow, /capture_helper "retained_gate_ts" "scripts\/check-research-retained-output-commit\.ts"/u);
  assert.match(workflow, /capture_helper "retained_gate_core" "src\/automation\/researchRetainedOutputCommitGate\.ts"/u);
});

test("post-task restore uses pre-task bytes while token-bearing commit keeps trusted binaries", () => {
  const restoreStart = workflow.indexOf("- name: Restore trusted automation commit helpers");
  const commitStart = workflow.indexOf("- name: Commit control state + results to automation branch");
  const restore = workflow.slice(restoreStart, commitStart);
  const commit = workflow.slice(commitStart);

  assert.match(restore, /BASH_ENV: \/dev\/null/u);
  assert.match(restore, /ENV: \/dev\/null/u);
  assert.match(restore, /LD_PRELOAD: ""/u);
  assert.match(restore, /LD_LIBRARY_PATH: ""/u);
  assert.match(restore, /DYLD_INSERT_LIBRARIES: ""/u);
  assert.match(restore, /DYLD_LIBRARY_PATH: ""/u);
  assert.match(restore, /DYLD_FRAMEWORK_PATH: ""/u);
  assert.match(restore, /DYLD_FALLBACK_LIBRARY_PATH: ""/u);
  assert.match(restore, /DYLD_FALLBACK_FRAMEWORK_PATH: ""/u);
  assert.match(restore, /PERL5OPT: ""/u);
  assert.match(restore, /PATH: \/usr\/bin:\/bin:\/usr\/sbin:\/sbin/u);
  assert.match(restore, /COMMIT_SCRIPT_B64: \$\{\{ steps\.materialize_authority\.outputs\.commit_script_b64 \}\}/u);
  assert.match(restore, /COMMIT_SCRIPT_SHA256: \$\{\{ steps\.materialize_authority\.outputs\.commit_script_sha256 \}\}/u);
  assert.match(restore, /\/usr\/bin\/base64 -D/u);
  assert.match(restore, /\/bin\/mv -f "\$tmp" "\$path"/u);
  assert.doesNotMatch(restore, /TRUSTED_GIT_BIN/u);
  assert.doesNotMatch(restore, /git checkout/u);

  assert.match(commit, /BASH_ENV: \/dev\/null/u);
  assert.match(commit, /LD_PRELOAD: ""/u);
  assert.match(commit, /LD_LIBRARY_PATH: ""/u);
  assert.match(commit, /DYLD_INSERT_LIBRARIES: ""/u);
  assert.match(commit, /DYLD_LIBRARY_PATH: ""/u);
  assert.match(commit, /DYLD_FRAMEWORK_PATH: ""/u);
  assert.match(commit, /DYLD_FALLBACK_LIBRARY_PATH: ""/u);
  assert.match(commit, /DYLD_FALLBACK_FRAMEWORK_PATH: ""/u);
  assert.match(commit, /NODE_OPTIONS: ""/u);
  assert.match(commit, /NODE_PATH: ""/u);
  assert.match(commit, /PATH: \/usr\/bin:\/bin:\/usr\/sbin:\/sbin/u);
  assert.match(commit, /TRUSTED_NODE_BIN: \$\{\{ steps\.materialize_authority\.outputs\.trusted_node_bin \}\}/u);
  assert.match(commit, /TRUSTED_NODE_SHA256: \$\{\{ steps\.materialize_authority\.outputs\.trusted_node_sha256 \}\}/u);
  assert.match(commit, /CURRENT_NODE_SHA256=/u);
  assert.match(commit, /BOAT_PON_AUTOMATION_PUSH_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.match(commit, /exec \/bin\/bash scripts\/automation-commit\.sh/u);
});

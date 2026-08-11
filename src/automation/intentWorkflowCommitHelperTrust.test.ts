import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflowPath = resolve(process.cwd(), ".github/workflows/boat-pon-intent-dispatch.yml");

test("intent workflow restores pre-task helper bytes before exposing the push token", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const materializeStep = workflow.indexOf("- name: Materialize control state and dataset authority from automation branch");
  const taskStep = workflow.indexOf("- name: Run exactly one task");
  const restoreStep = workflow.indexOf("- name: Restore trusted automation commit helpers");
  const commitStep = workflow.indexOf("- name: Commit control state + results to automation branch");
  const tokenBinding = workflow.indexOf("BOAT_PON_AUTOMATION_PUSH_TOKEN: ${{ github.token }}");
  const helperCapture = workflow.indexOf('capture_helper "commit_script" "scripts/automation-commit.sh"');

  assert.notEqual(materializeStep, -1);
  assert.notEqual(taskStep, -1);
  assert.notEqual(restoreStep, -1);
  assert.notEqual(commitStep, -1);
  assert.notEqual(tokenBinding, -1);
  assert.notEqual(helperCapture, -1);
  assert.ok(materializeStep < helperCapture);
  assert.ok(helperCapture < taskStep);
  assert.ok(taskStep < restoreStep);
  assert.ok(restoreStep < commitStep);
  assert.ok(commitStep < tokenBinding);

  const restoreSegment = workflow.slice(restoreStep, commitStep);
  const sanitizeEnvironment = restoreSegment.indexOf('GIT_*|DYLD_*) unset "$env_name"');
  const restoreCall = restoreSegment.indexOf(
    'restore_helper "scripts/automation-commit.sh" "$COMMIT_SCRIPT_B64" "$COMMIT_SCRIPT_SHA256" "$COMMIT_SCRIPT_MODE"',
  );

  assert.notEqual(sanitizeEnvironment, -1);
  assert.notEqual(restoreCall, -1);
  assert.ok(sanitizeEnvironment < restoreCall);
  assert.match(restoreSegment, /COMMIT_SCRIPT_B64: \$\{\{ steps\.materialize_authority\.outputs\.commit_script_b64 \}\}/u);
  assert.match(restoreSegment, /actual_digest="\$\(\/usr\/bin\/shasum -a 256 "\$tmp"/u);
  assert.match(restoreSegment, /trusted helper bytes changed after task execution/u);
  assert.match(restoreSegment, /if \[ ! -d "\$dir" \] \|\| \[ -L "\$dir" \]/u);
  assert.match(restoreSegment, /\/bin\/mv -f "\$tmp" "\$path"/u);
  assert.doesNotMatch(restoreSegment, /git checkout/u);
  assert.doesNotMatch(restoreSegment, /TRUSTED_GIT_BIN/u);

  assert.match(restoreSegment, /LD_PRELOAD: ""/u);
  assert.match(restoreSegment, /LD_LIBRARY_PATH: ""/u);
  assert.match(restoreSegment, /DYLD_INSERT_LIBRARIES: ""/u);
  assert.match(restoreSegment, /DYLD_LIBRARY_PATH: ""/u);
  assert.match(restoreSegment, /NODE_OPTIONS: ""/u);
  assert.match(restoreSegment, /NODE_PATH: ""/u);
  assert.match(workflow, /if: always\(\) && steps\.restore_commit_helper\.outcome == 'success'/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.doesNotMatch(workflow, /http\.https:\/\/github\.com\/\.extraheader/u);
  assert.match(workflow, /exec \/bin\/bash scripts\/automation-commit\.sh/u);
});

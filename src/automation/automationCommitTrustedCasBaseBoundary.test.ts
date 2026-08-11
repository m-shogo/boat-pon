import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(process.cwd());
const workflow = readFileSync(
  resolve(repoRoot, ".github/workflows/boat-pon-intent-dispatch.yml"),
  "utf8",
);
const commit = readFileSync(resolve(repoRoot, "scripts/automation-commit.sh"), "utf8");

test("automation CAS base is passed from trusted materialize step output, not a task-writable file", () => {
  assert.match(workflow, /id: materialize_authority/u);
  assert.match(workflow, /echo "branch_base_sha=\$BASE_SHA" >> "\$GITHUB_OUTPUT"/u);
  assert.match(
    workflow,
    /EXPECTED_AUTOMATION_BRANCH_BASE: \$\{\{ steps\.materialize_authority\.outputs\.branch_base_sha \}\}/u,
  );
  assert.doesNotMatch(workflow, /\.automation-branch-base/u);

  assert.match(commit, /EXPECTED_BASE_SHA="\$\{EXPECTED_AUTOMATION_BRANCH_BASE:-\}"/u);
  assert.match(commit, /unset EXPECTED_AUTOMATION_BRANCH_BASE/u);
  assert.match(commit, /\^\[0-9a-f\]\{40\}\$/u);
  assert.match(commit, /if \[ "\$EXPECTED_BASE_SHA" != "\$CUR_SHA" \]; then/u);
  assert.doesNotMatch(commit, /\.automation-branch-base/u);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflowPath = resolve(process.cwd(), ".github/workflows/boat-pon-intent-dispatch.yml");

test("intent workflow restores trusted commit helpers before exposing the push token", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const restoreStep = workflow.indexOf("- name: Restore trusted automation commit helpers");
  const tokenBinding = workflow.indexOf("BOAT_PON_AUTOMATION_PUSH_TOKEN: ${{ github.token }}");
  const trustedCheckout = workflow.indexOf(
    '"$TRUSTED_GIT_BIN" -c core.hooksPath=/dev/null -c core.fsmonitor=false checkout "${GITHUB_SHA}" --',
  );

  assert.notEqual(restoreStep, -1);
  assert.notEqual(trustedCheckout, -1);
  assert.notEqual(tokenBinding, -1);
  assert.ok(restoreStep < tokenBinding);
  assert.ok(trustedCheckout < tokenBinding);
  assert.match(workflow, /if: always\(\) && steps\.restore_commit_helper\.outcome == 'success'/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /http\.https:\/\/github\.com\/\.extraheader/);
  assert.match(workflow, /exec \/bin\/bash scripts\/automation-commit\.sh/);
});

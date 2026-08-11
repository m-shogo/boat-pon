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

  const restoreSegment = workflow.slice(restoreStep, tokenBinding);
  const sanitizeGitEnvironment = restoreSegment.indexOf('GIT_*|DYLD_*) unset "$env_name"');
  const sanitizeProxyEnvironment = restoreSegment.indexOf(
    "unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy",
  );
  const disableSystemGitConfig = restoreSegment.indexOf("export GIT_CONFIG_NOSYSTEM=1");
  const disableGlobalGitConfig = restoreSegment.indexOf("export GIT_CONFIG_GLOBAL=/dev/null");
  const restoreCheckout = restoreSegment.indexOf(
    '"$TRUSTED_GIT_BIN" -c core.hooksPath=/dev/null -c core.fsmonitor=false checkout "${GITHUB_SHA}" --',
  );

  assert.notEqual(sanitizeGitEnvironment, -1);
  assert.notEqual(sanitizeProxyEnvironment, -1);
  assert.notEqual(disableSystemGitConfig, -1);
  assert.notEqual(disableGlobalGitConfig, -1);
  assert.notEqual(restoreCheckout, -1);
  assert.ok(sanitizeGitEnvironment < restoreCheckout);
  assert.ok(sanitizeProxyEnvironment < restoreCheckout);
  assert.ok(disableSystemGitConfig < restoreCheckout);
  assert.ok(disableGlobalGitConfig < restoreCheckout);

  assert.match(restoreSegment, /LD_PRELOAD: ""/);
  assert.match(restoreSegment, /LD_LIBRARY_PATH: ""/);
  assert.match(restoreSegment, /NODE_OPTIONS: ""/);
  assert.match(restoreSegment, /NODE_PATH: ""/);
  assert.match(workflow, /if: always\(\) && steps\.restore_commit_helper\.outcome == 'success'/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /http\.https:\/\/github\.com\/\.extraheader/);
  assert.match(workflow, /exec \/bin\/bash scripts\/automation-commit\.sh/);
});

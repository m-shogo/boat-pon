import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const script = readFileSync(
  resolve(process.cwd(), "scripts/automation-commit.sh"),
  "utf8",
);

test("automation commit sanitizes task-controlled git transport environment before trusted git use", () => {
  assert.match(script, /GIT_\*\) unset "\$env_name"/u);
  assert.match(
    script,
    /unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy/u,
  );
  assert.match(script, /export GIT_CONFIG_NOSYSTEM=1/u);
  assert.match(script, /export GIT_CONFIG_GLOBAL=\/dev\/null/u);

  const sanitizeIndex = script.indexOf("while IFS= read -r env_name; do");
  const firstTrustedGitIndex = script.indexOf('cd "$(git_no_hooks rev-parse --show-toplevel)"');
  assert.notEqual(sanitizeIndex, -1);
  assert.notEqual(firstTrustedGitIndex, -1);
  assert.ok(
    sanitizeIndex < firstTrustedGitIndex,
    "task-controlled git environment must be removed before the first trusted git invocation",
  );
});

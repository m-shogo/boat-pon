import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const script = readFileSync(
  resolve(process.cwd(), "scripts/automation-commit.sh"),
  "utf8",
);

test("automation commit sanitizes task-controlled runtime before trusted git/node use", () => {
  assert.match(script, /GIT_\*\|DYLD_\*\) unset "\$env_name"/u);
  assert.match(
    script,
    /unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy/u,
  );
  assert.match(script, /unset NODE_OPTIONS NODE_PATH BASH_ENV ENV LD_PRELOAD LD_LIBRARY_PATH/u);
  assert.match(script, /export PATH=\/usr\/bin:\/bin:\/usr\/sbin:\/sbin/u);
  assert.match(script, /export GIT_CONFIG_NOSYSTEM=1/u);
  assert.match(script, /export GIT_CONFIG_GLOBAL=\/dev\/null/u);
  assert.match(script, /TRUSTED_GIT_BIN="\$\{TRUSTED_GIT_BIN:-\}"/u);
  assert.match(script, /TRUSTED_NODE_BIN="\$\{TRUSTED_NODE_BIN:-\}"/u);

  const sanitizeIndex = script.indexOf("export PATH=/usr/bin:/bin:/usr/sbin:/sbin");
  const firstTrustedGitIndex = script.indexOf('GIT_TOP_LEVEL="$(git_no_hooks rev-parse --show-toplevel)"');
  const retainedGateIndex = script.indexOf('"$TRUSTED_NODE_BIN" scripts/check-research-retained-output-commit.mjs');
  assert.notEqual(sanitizeIndex, -1);
  assert.notEqual(firstTrustedGitIndex, -1);
  assert.notEqual(retainedGateIndex, -1);
  assert.ok(sanitizeIndex < firstTrustedGitIndex);
  assert.ok(sanitizeIndex < retainedGateIndex);
});
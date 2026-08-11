import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const scriptPath = resolve(process.cwd(), "scripts/automation-commit.sh");

test("automation commit removes raw push token before child processes and authenticates only at push", () => {
  const script = readFileSync(scriptPath, "utf8");
  const capture = script.indexOf('PUSH_TOKEN="${BOAT_PON_AUTOMATION_PUSH_TOKEN:-}"');
  const unset = script.indexOf("unset BOAT_PON_AUTOMATION_PUSH_TOKEN");
  const retainedGate = script.indexOf("node --import tsx scripts/check-research-retained-output-commit.ts");
  const authenticatedPush = script.indexOf('git_no_hooks -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $auth_header" push origin "$BRANCH" --quiet');

  assert.notEqual(capture, -1);
  assert.notEqual(unset, -1);
  assert.notEqual(retainedGate, -1);
  assert.notEqual(authenticatedPush, -1);
  assert.ok(capture < unset);
  assert.ok(unset < retainedGate);
  assert.ok(retainedGate < authenticatedPush);
  assert.doesNotMatch(script, /git(?:_no_hooks)? config --local http\.https:\/\/github\.com\/\.extraheader/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const script = readFileSync(resolve(process.cwd(), "scripts/automation-commit.sh"), "utf8");

test("automation commit rechecks repo-local transport config after task-controlled staging", () => {
  const fetchGuard = script.indexOf("assert_trusted_transport_config");
  const add = script.indexOf('git_no_hooks add -- "$path"');
  const postStageGuard = script.indexOf("assert_trusted_transport_config", fetchGuard + 1);
  const commit = script.indexOf("git_no_hooks commit -q");
  const push = script.indexOf('push "$AUTHORITY_REMOTE_URL" "$BRANCH"');

  assert.notEqual(fetchGuard, -1);
  assert.notEqual(add, -1);
  assert.notEqual(postStageGuard, -1);
  assert.notEqual(commit, -1);
  assert.notEqual(push, -1);
  assert.ok(fetchGuard < add);
  assert.ok(add < postStageGuard);
  assert.ok(postStageGuard < commit);
  assert.ok(postStageGuard < push);
  assert.match(script, /git add は task-controlled clean filter を実行し得る/u);
});

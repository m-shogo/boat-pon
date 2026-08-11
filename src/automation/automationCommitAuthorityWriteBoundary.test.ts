import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const script = readFileSync(resolve(process.cwd(), "scripts/automation-commit.sh"), "utf8");

test("automation commit revalidates authority destination tree after branch checkout", () => {
  const authorityCheckout = script.indexOf('git_no_hooks checkout -B "$BRANCH" "origin/$BRANCH" --quiet');
  const symlinkGuard = script.indexOf('refusing authority write through symbolic link');
  const nonFileGuard = script.indexOf('authority destination is not a regular file');
  const writeback = script.indexOf('cp "$STAGE/$path" "$REPO_ROOT/$path"');
  const stage = script.indexOf('git_no_hooks add -- "$path"');

  assert.notEqual(authorityCheckout, -1);
  assert.notEqual(symlinkGuard, -1);
  assert.notEqual(nonFileGuard, -1);
  assert.notEqual(writeback, -1);
  assert.notEqual(stage, -1);
  assert.ok(authorityCheckout < symlinkGuard);
  assert.ok(symlinkGuard < nonFileGuard);
  assert.ok(nonFileGuard < writeback);
  assert.ok(writeback < stage);
  assert.match(script, /if \[ -L "\$REPO_ROOT\/\$probe" \]; then/u);
  assert.match(script, /if \[ -e "\$REPO_ROOT\/\$path" \] && \[ ! -f "\$REPO_ROOT\/\$path" \]; then/u);
});

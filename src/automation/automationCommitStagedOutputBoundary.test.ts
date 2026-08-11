import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const script = readFileSync(
  resolve(process.cwd(), "scripts/automation-commit.sh"),
  "utf8",
);

test("automation commit verifies staged paths and bytes before commit", () => {
  const addIndex = script.indexOf('git_no_hooks add -- "$path"');
  const stagedScanIndex = script.indexOf("git_no_hooks diff --cached --name-only -z");
  const commitIndex = script.indexOf("git_no_hooks commit -q -m");

  assert.ok(addIndex >= 0);
  assert.ok(stagedScanIndex > addIndex);
  assert.ok(commitIndex > stagedScanIndex);
  assert.match(script, /unexpected staged path after allowlist staging/u);
  assert.match(script, /git_no_hooks hash-object --no-filters "\$source_path"/u);
  assert.match(script, /git_no_hooks rev-parse ":\$staged_path"/u);
  assert.match(script, /staged blob differs from validated source bytes/u);
});

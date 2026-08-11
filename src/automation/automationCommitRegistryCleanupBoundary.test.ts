import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(process.cwd());
const commitScript = resolve(repoRoot, "scripts/automation-commit.sh");

test("automation commit cleans allowlisted research registry roots before branch switch", () => {
  const source = readFileSync(commitScript, "utf8");

  assert.match(
    source,
    /git_no_hooks clean -fdq -- automation reports docs research 2>\/dev\/null \|\| true/,
  );
  assert.ok(
    source.indexOf("git_no_hooks clean -fdq -- automation reports docs research") <
      source.indexOf("git_no_hooks checkout -B \"$BRANCH\""),
    "registry cleanup must happen before switching to the automation branch",
  );
});

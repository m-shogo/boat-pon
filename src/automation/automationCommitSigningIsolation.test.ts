import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const script = readFileSync(resolve(process.cwd(), "scripts/automation-commit.sh"), "utf8");

test("automation commit disables task-controlled commit signing callbacks for every trusted git invocation", () => {
  const gitWrapperStart = script.indexOf("git_no_hooks() {");
  const gitWrapperEnd = script.indexOf("\n}", gitWrapperStart);
  const gitWrapper = script.slice(gitWrapperStart, gitWrapperEnd + 2);
  const commit = script.indexOf("git_no_hooks commit -q");

  assert.notEqual(gitWrapperStart, -1);
  assert.notEqual(gitWrapperEnd, -1);
  assert.notEqual(commit, -1);
  assert.match(gitWrapper, /-c core\.hooksPath=\/dev\/null/u);
  assert.match(gitWrapper, /-c core\.fsmonitor=false/u);
  assert.match(gitWrapper, /-c commit\.gpgSign=false/u);
  assert.match(script, /gpg\.program/u);
});

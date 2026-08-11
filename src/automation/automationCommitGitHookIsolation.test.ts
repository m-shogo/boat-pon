import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(process.cwd());
const commitScript = resolve(repoRoot, "scripts/automation-commit.sh");

test("automation commit routes every git command through hook isolation", () => {
  const source = readFileSync(commitScript, "utf8");
  const directGitLines = source
    .split("\n")
    .filter((line) => /^\s*git(?:\s|$)/u.test(line));

  assert.deepEqual(directGitLines, ['  git -c core.hooksPath=/dev/null "$@"']);
  assert.match(source, /git_no_hooks checkout -- \. /u);
  assert.match(source, /git_no_hooks commit -q -m/u);
  assert.match(
    source,
    /git_no_hooks -c "http\.https:\/\/github\.com\/\.extraheader=AUTHORIZATION: basic \$auth_header" push/u,
  );
});

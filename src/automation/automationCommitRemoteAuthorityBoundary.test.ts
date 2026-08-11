import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const script = readFileSync(
  resolve(process.cwd(), "scripts/automation-commit.sh"),
  "utf8",
);

test("automation commit pins fetch and push to the repository authority URL", () => {
  assert.match(
    script,
    /AUTHORITY_REMOTE_URL="https:\/\/github\.com\/m-shogo\/boat-pon\.git"/u,
  );
  assert.match(
    script,
    /git_no_hooks fetch "\$AUTHORITY_REMOTE_URL" "refs\/heads\/\$BRANCH:refs\/remotes\/origin\/\$BRANCH" --quiet/u,
  );
  assert.match(
    script,
    /push "\$AUTHORITY_REMOTE_URL" "\$BRANCH" --quiet/u,
  );
  assert.doesNotMatch(script, /git_no_hooks fetch origin /u);
  assert.doesNotMatch(script, /push origin "\$BRANCH"/u);
});

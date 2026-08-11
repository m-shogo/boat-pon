import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const script = readFileSync(
  resolve(process.cwd(), "scripts/automation-commit.sh"),
  "utf8",
);

test("automation commit preserves immutable research outputs against authority branch", () => {
  assert.match(
    script,
    /IMMUTABLE_PREFIXES=\("reports\/automation\/history\/" "reports\/automation\/retained-outputs\/" "research\/registries\/experiments\/" "research\/registries\/discoveries\/"\)/u,
  );
  assert.match(
    script,
    /git_no_hooks fetch "\$AUTHORITY_REMOTE_URL" "refs\/heads\/\$BRANCH:refs\/remotes\/origin\/\$BRANCH" --quiet/u,
  );
  assert.match(script, /git_no_hooks cat-file -e "origin\/\$BRANCH:\$path"/u);
  assert.match(script, /git_no_hooks hash-object --no-filters "\$STAGE\/\$path"/u);
  assert.match(script, /refusing to rewrite immutable research output/u);

  const casIndex = script.indexOf('if [ "$EXPECTED_BASE_SHA" != "$CUR_SHA" ]; then');
  const immutableIndex = script.indexOf("refusing to rewrite immutable research output");
  const checkoutIndex = script.indexOf('git_no_hooks checkout -B "$BRANCH"');
  assert.ok(casIndex >= 0);
  assert.ok(immutableIndex > casIndex);
  assert.ok(checkoutIndex > immutableIndex);
});

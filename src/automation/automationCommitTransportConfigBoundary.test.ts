import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const script = readFileSync(
  resolve(process.cwd(), "scripts/automation-commit.sh"),
  "utf8",
);

test("automation commit rejects repo-local git transport configuration before authority fetch", () => {
  assert.match(script, /config --local --includes --name-only --get-regexp/u);
  assert.match(script, /http\\\./u);
  assert.match(script, /url\\\./u);
  assert.match(script, /credential\\\./u);
  assert.match(script, /include\(if\)\?\\\./u);
  assert.match(script, /untrusted repo-local git transport config detected/u);

  const guardIndex = script.indexOf("assert_trusted_transport_config\n");
  const fetchIndex = script.indexOf('git_no_hooks fetch "$AUTHORITY_REMOTE_URL"');
  assert.notEqual(guardIndex, -1);
  assert.notEqual(fetchIndex, -1);
  assert.ok(guardIndex < fetchIndex, "transport config guard must run before authority fetch");
});

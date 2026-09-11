import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-payout-rebase.ts", "utf8");

test("payout-rebase entrypoint does not inherit raw child stderr", () => {
  assert.match(entrypoint, /encoding: "utf8"/);
  assert.match(entrypoint, /stdio: \["ignore", "pipe", "pipe"\]/);
  assert.doesNotMatch(entrypoint, /stdio: "inherit"/);
  assert.match(entrypoint, /GUARDED_STEP_SPAWN_FAILED/);
  assert.match(entrypoint, /GUARDED_STEP_FAILED/);
  assert.doesNotMatch(entrypoint, /result\.error\.message/);
});

test("payout-rebase entrypoint replays child stdout only after a zero exit status", () => {
  const status = entrypoint.indexOf("const status = result.status ?? 1");
  const failureGuard = entrypoint.indexOf("if (status !== 0)", status);
  const stdout = entrypoint.indexOf("process.stdout.write(result.stdout)", failureGuard);
  const returnStatus = entrypoint.indexOf("return status", stdout);
  assert.ok(status >= 0 && failureGuard > status && stdout > failureGuard && returnStatus > stdout);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("runner lock acquisition is exclusive and never replaces an existing lock", () => {
  const source = readFileSync("scripts/run-intent-task.ts", "utf8");
  const acquire = source.slice(source.indexOf("function acquireLock("), source.indexOf("function releaseLock("));

  assert.match(acquire, /writeFileSync\(LOCK_PATH, payload, \{ flag: "wx" \}\)/);
  assert.match(acquire, /code === "EEXIST"/);
  assert.doesNotMatch(acquire, /renameSync\([^\n]*LOCK_PATH/);
  assert.doesNotMatch(acquire, /rmSync\(LOCK_PATH/);
});

test("runner releases only the lock token it acquired", () => {
  const source = readFileSync("scripts/run-intent-task.ts", "utf8");
  const release = source.slice(source.indexOf("function releaseLock("), source.indexOf("let LOCKED = false"));

  assert.match(source, /let LOCK_TOKEN: string \| null = null/);
  assert.match(release, /current\.lockToken === token/);
  assert.ok(release.indexOf("current.lockToken === token") < release.indexOf("rmSync(LOCK_PATH"));
  assert.match(release, /Ownership cannot be proven: keep the lock fail-closed/);
});

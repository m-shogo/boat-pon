import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/report-bet-type-selector-summary.ts", "utf8");

test("bet-type selector summary does not inherit raw child stderr on internal failure", () => {
  assert.match(entry, /encoding: "utf8"/);
  assert.match(entry, /stdio: \["ignore", "pipe", "pipe"\]/);
  assert.doesNotMatch(entry, /stdio: "inherit"/);
  assert.match(entry, /throw new Error\("BET_TYPE_SELECTOR_INTERNAL_SPAWN_FAILED"\)/);
  assert.match(entry, /console\.error\("BET_TYPE_SELECTOR_INTERNAL_FAILED"\)/);

  const spawn = entry.indexOf("const result = spawnSync(");
  const failure = entry.indexOf('console.error("BET_TYPE_SELECTOR_INTERNAL_FAILED")');
  const successOutput = entry.indexOf("process.stdout.write(result.stdout)");
  assert.ok(spawn >= 0 && failure > spawn && successOutput > failure);
});

test("bet-type selector summary only replays child stdout after a zero exit status", () => {
  const status = entry.indexOf("const status = result.status ?? 1");
  const failureGuard = entry.indexOf("if (status !== 0)", status);
  const stdout = entry.indexOf("process.stdout.write(result.stdout)", failureGuard);
  const returnStatus = entry.indexOf("return status", stdout);
  assert.ok(status >= 0 && failureGuard > status && stdout > failureGuard && returnStatus > stdout);
});

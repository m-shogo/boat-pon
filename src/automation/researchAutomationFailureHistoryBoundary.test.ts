import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const contract = readFileSync(
  resolve(process.cwd(), "src/automation/researchAutomationFailureHistory.ts"),
  "utf8",
);
const runner = readFileSync(resolve(process.cwd(), "scripts/run-intent-task.ts"), "utf8");

test("failure history contract is isolated from product and storage behavior", () => {
  assert.match(contract, /research-automation-failure-history-v1/u);
  assert.match(contract, /result:\s*ResearchAutomationFailureResult/u);
  assert.match(contract, /executed:\s*true/u);
  assert.match(contract, /outputs:\s*\[\]/u);
  assert.doesNotMatch(contract, /DatabaseSync|openDb|\bfetch\s*\(|child_process|execSync|spawnSync/u);
  assert.doesNotMatch(contract, /app_settings|send-line|notify|auto_purchase|auto_vote|data\/raw|data\/private/u);
});

test("runner routes persisted failure paths through the durable contract", () => {
  assert.match(runner, /buildResearchAutomationFailureHistory/u);
  const calls = [...runner.matchAll(/buildResearchAutomationFailureHistory\(/gu)].length;
  assert.ok(calls >= 3, `expected at least 3 failure-history builder calls, got ${calls}`);
  assert.doesNotMatch(runner, /executed:\s*false,\s*result:\s*"BLOCKED"/u);
  assert.doesNotMatch(runner, /result:\s*finalStatus,\s*error:/u);
  assert.match(runner, /failureCode:\s*"UNEXPECTED_DRY_RUN_RESULT"/u);
});

test("persisted histories canonicalize authority SHA to full git identity", () => {
  const canonical = /authoritySha:\s*git\("rev-parse",\s*request\.authoritySha\)/gu;
  assert.ok([...runner.matchAll(canonical)].length >= 4);
});

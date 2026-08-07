import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const retained = readFileSync(resolve(process.cwd(), "src/automation/researchRetainedOutputs.ts"), "utf8");
const scanner = readFileSync(resolve(process.cwd(), "src/automation/researchDurableKnowledgeCompleteness.ts"), "utf8");
const runner = readFileSync(resolve(process.cwd(), "scripts/run-intent-task.ts"), "utf8");

test("retained outputs are isolated content-addressed research evidence", () => {
  assert.match(retained, /reports\/automation\/retained-outputs/u);
  assert.match(retained, /sha256Buffer/u);
  assert.match(retained, /RETAINED_OUTPUT_EXISTING_CONTENT_MISMATCH/u);
  assert.doesNotMatch(retained, /data\/raw|data\/private|boat\.sqlite|sidecar|DatabaseSync|\bfetch\s*\(|send-line|notify|auto_purchase|auto_vote/u);
});

test("registries remain original append-only evidence", () => {
  assert.match(retained, /PASSTHROUGH_IMMUTABLE_ROOTS/u);
  assert.match(retained, /research\/registries\//u);
  assert.match(retained, /classification === "IMMUTABLE"/u);
});

test("durable scanner verifies retained path content hash", () => {
  assert.match(scanner, /"RETAINED"/u);
  assert.match(scanner, /RETAINED_CONTENT_DIGEST_VERIFIED/u);
  assert.match(scanner, /DURABLE_RETAINED_CONTENT_DIGEST_MISMATCH/u);
  assert.match(scanner, /DURABLE_RETAINED_HISTORY_DIGEST_MISMATCH/u);
});

test("runner uses existing failure history contract if retention fails", () => {
  assert.match(runner, /retainExecutorOutputs/u);
  assert.match(runner, /DURABLE_OUTPUT_RETENTION_FAILED/u);
  assert.match(runner, /buildResearchAutomationFailureHistory/u);
  assert.match(runner, /historyOutputs/u);
  const retainCall = runner.indexOf("retainExecutorOutputs({");
  const attempts = runner.indexOf("const attempts = state.tasks[task.taskId]?.attemptCount", retainCall);
  assert.ok(retainCall >= 0 && attempts > retainCall);
});

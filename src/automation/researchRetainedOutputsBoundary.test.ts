import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const retained = readFileSync(resolve(process.cwd(), "src/automation/researchRetainedOutputs.ts"), "utf8");
const scanner = readFileSync(resolve(process.cwd(), "src/automation/researchDurableKnowledgeCompleteness.ts"), "utf8");
const runner = readFileSync(resolve(process.cwd(), "scripts/run-intent-task.ts"), "utf8");

test("retained outputs are content-addressed under reports automation only", () => {
  assert.match(retained, /reports\/automation\/retained-outputs/u);
  assert.match(retained, /contentDigest/u);
  assert.match(retained, /sha256Buffer/u);
  assert.match(retained, /RETAINED_OUTPUT_EXISTING_CONTENT_MISMATCH/u);
  assert.doesNotMatch(retained, /data\/raw|data\/private|boat\.sqlite|sidecar/u);
  assert.doesNotMatch(retained, /DatabaseSync|openDb|\bfetch\s*\(|child_process|execSync|spawnSync/u);
  assert.doesNotMatch(retained, /send-line|notify|auto_purchase|auto_vote|production_writer|live_odds_writer/u);
});

test("registries remain original append-only evidence instead of being downgraded to copies", () => {
  assert.match(retained, /PASSTHROUGH_IMMUTABLE_ROOTS/u);
  assert.match(retained, /research\/registries\//u);
  assert.match(retained, /classification === "IMMUTABLE"/u);
});

test("durable scanner verifies retained path content hash", () => {
  assert.match(scanner, /"RETAINED"/u);
  assert.match(scanner, /RETAINED_CONTENT_DIGEST_VERIFIED/u);
  assert.match(scanner, /DURABLE_RETAINED_CONTENT_DIGEST_MISMATCH/u);
  assert.match(scanner, /reports\/automation\/retained-outputs/u);
});

test("runner retains executor outputs before terminal state and history write", () => {
  assert.match(runner, /retainExecutorOutputs/u);
  const retainCallIndex = runner.indexOf("retainExecutorOutputs({");
  const attemptsIndex = runner.indexOf("const attempts = state.tasks[task.taskId]?.attemptCount", retainCallIndex);
  const historyWriteIndex = runner.indexOf("writeJsonAtomic(join(HISTORY_DIR", attemptsIndex);
  assert.ok(retainCallIndex >= 0);
  assert.ok(attemptsIndex > retainCallIndex);
  assert.ok(historyWriteIndex > attemptsIndex);
  assert.match(runner, /DURABLE_OUTPUT_RETENTION_FAILED/u);
  assert.match(runner, /historyOutputs/u);
});

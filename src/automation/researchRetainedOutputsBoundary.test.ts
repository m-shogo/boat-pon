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

test("retained output materialization is validate-first, rollback-bounded and deduplicated", () => {
  assert.match(retained, /Phase 1: classify and validate every source before creating any retained file/u);
  assert.match(retained, /Phase 2: materialize only after every source\/target and the aggregate budget have been validated/u);
  assert.match(retained, /preparedByRetainedPath/u);
  assert.match(retained, /historyOutputSet/u);
  assert.match(retained, /created\.reverse\(\)/u);
  assert.match(retained, /unlinkSync\(path\)/u);
  assert.match(retained, /RETAINED_OUTPUT_TARGET_COLLISION/u);
});

test("retained publish readback is descriptor-bound after atomic publication", () => {
  assert.match(retained, /function verifyPublishedRetainedTarget/u);
  const helperStart = retained.indexOf("function verifyPublishedRetainedTarget");
  const materializeStart = retained.indexOf("function materializePreparedOutputs", helperStart);
  const helper = retained.slice(helperStart, materializeStart);
  assert.match(helper, /openSync\(item\.retainedAbsolutePath, constants\.O_RDONLY \| constants\.O_NOFOLLOW \| constants\.O_NONBLOCK\)/u);
  assert.match(helper, /fstatSync\(fd\)/u);
  assert.match(helper, /stat\.nlink !== 2/u);
  assert.match(helper, /readSync\(fd/u);
  assert.match(helper, /fchmodSync\(fd, 0o644\)/u);
  assert.doesNotMatch(retained, /chmodSync\(item\.retainedAbsolutePath/u);
  assert.doesNotMatch(retained, /readFileSync\(item\.retainedAbsolutePath/u);
});

test("retained temp staging is exclusive and verified through the created descriptor", () => {
  const materializeStart = retained.indexOf("function materializePreparedOutputs");
  const materialize = retained.slice(materializeStart);
  assert.match(materialize, /constants\.O_CREAT \| constants\.O_EXCL \| constants\.O_RDWR \| constants\.O_NOFOLLOW/u);
  assert.match(materialize, /RETAINED_OUTPUT_TEMP_RACE/u);
  assert.match(materialize, /writeSync\(\s*tempFd/u);
  assert.match(materialize, /fstatSync\(tempFd\)/u);
  assert.match(materialize, /tempStat\.nlink !== 1/u);
  assert.match(materialize, /readSync\(tempFd/u);
  assert.doesNotMatch(retained, /writeFileSync\(tempPath/u);
  assert.doesNotMatch(retained, /readFileSync\(tempPath/u);
});

test("retained output count and aggregate bytes are fail-closed per run", () => {
  assert.match(retained, /MAX_EXECUTOR_OUTPUT_PATHS\s*=\s*64/u);
  assert.match(retained, /MAX_RETAINED_TOTAL_BYTES\s*=\s*8_388_608/u);
  assert.match(retained, /RETAINED_OUTPUT_COUNT_EXCEEDED/u);
  assert.match(retained, /RETAINED_OUTPUT_TOTAL_BYTES_EXCEEDED/u);
  const countIndex = retained.indexOf("RETAINED_OUTPUT_COUNT_EXCEEDED");
  const prepareIndex = retained.indexOf("prepareMutableOutput({", countIndex);
  const budgetIndex = retained.indexOf("RETAINED_OUTPUT_TOTAL_BYTES_EXCEEDED", prepareIndex);
  const materializeIndex = retained.indexOf("materializePreparedOutputs(input.repoRoot, prepared)", budgetIndex);
  assert.ok(countIndex >= 0);
  assert.ok(prepareIndex > countIndex);
  assert.ok(budgetIndex > prepareIndex);
  assert.ok(materializeIndex > budgetIndex);
});

test("retained JSON is scanner-compatible before materialization", () => {
  assert.match(retained, /validateRetainedJsonSource/u);
  assert.match(retained, /RETAINED_OUTPUT_JSON_INVALID/u);
  assert.match(retained, /RETAINED_OUTPUT_HISTORY_DIGEST_MISMATCH/u);
  assert.match(retained, /RETAINED_OUTPUT_HISTORY_DIGEST_INVALID/u);
  const jsonValidation = retained.indexOf("validateRetainedJsonSource({");
  const contentDigest = retained.indexOf("const contentDigest = sha256Buffer(content)", jsonValidation);
  const materialize = retained.indexOf("materializePreparedOutputs(input.repoRoot, prepared)", contentDigest);
  assert.ok(jsonValidation >= 0);
  assert.ok(contentDigest > jsonValidation);
  assert.ok(materialize > contentDigest);
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
  assert.match(scanner, /DURABLE_RETAINED_HISTORY_DIGEST_MISMATCH/u);
  assert.match(scanner, /reports\/automation\/retained-outputs/u);
});

test("runner calls retention with executor digest before terminal state/history write", () => {
  const resultStateIndex = runner.indexOf("// ---- 結果を state へ反映 ----");
  const retainCallIndex = runner.indexOf("retainExecutorOutputs({", resultStateIndex);
  const terminalAttemptsIndex = runner.indexOf("const attempts = state.tasks[task.taskId]?.attemptCount", resultStateIndex);
  const historyWriteIndex = runner.indexOf("writeJsonAtomic(join(HISTORY_DIR", terminalAttemptsIndex);
  assert.ok(resultStateIndex >= 0);
  assert.ok(retainCallIndex > resultStateIndex);
  assert.ok(terminalAttemptsIndex > retainCallIndex);
  assert.ok(historyWriteIndex > terminalAttemptsIndex);
  const retainCall = runner.slice(retainCallIndex, terminalAttemptsIndex);
  assert.match(retainCall, /historyOutputDigest:\s*exec\.outputDigest/u);
  assert.match(runner, /DURABLE_OUTPUT_RETENTION_FAILED/u);
  assert.match(runner, /historyOutputs/u);
});

test("retention failure is fail-closed through the durable failure-history contract", () => {
  assert.match(runner, /buildResearchAutomationFailureHistory/u);
  assert.match(runner, /failureCode:\s*retentionBlock/u);
  assert.match(runner, /finalTaskStatus:\s*"BLOCKED"/u);
  assert.match(runner, /authoritySha:\s*git\("rev-parse", request\.authoritySha\)/u);
  assert.match(runner, /evidenceLinks:.*retentionEvidencePath.*exec\.outputs/u);
});
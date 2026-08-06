// TASK-N2-011 v4 queue migration.
//
// This is intentionally narrower than reconcile-catalog-state.ts: it may update only
// TASK-N2-011 plus queue/current-run metadata. It preserves every other task and both
// processed ledgers byte-for-byte. The apply path is guarded by automation branch HEAD
// CAS and the exact task-queue-state.json blob SHA.
//
// Dry run:
//   tsx scripts/migrate-n2-011-v4-queue.ts --expected-queue-blob-sha=<blob>
// Apply/materialize (commit/push remains delegated to automation-commit.sh):
//   tsx scripts/migrate-n2-011-v4-queue.ts --apply --expected-queue-blob-sha=<blob>
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  N2_011_TARGET_CATALOG_VERSION,
  N2_011_TARGET_DEFINITION_VERSION,
  migrateN2011QueueToV4,
} from "../src/automation/n2QueueMigration";
import { computeStateDigest, validateCatalog, validateQueueState } from "../src/automation/taskCatalog";
import { atomicWriteJson, verifyJsonReadback } from "../src/research/governance/executorSdk";

const root = resolve(process.cwd());
const BRANCH = "automation/boat-pon-research";
const QUEUE_PATH = "automation/control/task-queue-state.json";
const CURRENT_RUN_PATH = "automation/control/current-run.json";
const PROCESSED_INTENTS_PATH = "automation/control/processed-intents.json";
const PROCESSED_REQUESTS_PATH = "automation/control/processed-requests.json";
const CONTROL_PATHS = [
  QUEUE_PATH,
  CURRENT_RUN_PATH,
  PROCESSED_INTENTS_PATH,
  PROCESSED_REQUESTS_PATH,
  "automation/control/planner-candidates.json",
];

const apply = process.argv.includes("--apply");
const arg = (name: string): string | null => {
  const inline = process.argv.find((v) => v.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const expectedQueueBlobSha = arg("expected-queue-blob-sha");
const git = (...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const showBranchRaw = (path: string): string => execFileSync(
  "git", ["show", `origin/${BRANCH}:${path}`], { cwd: root, encoding: "utf8" },
);
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const die = (message: string): never => {
  console.error(`::error::${message}`);
  process.exit(1);
};

// 1. Validate immutable main catalog authority.
const catalogValidation = validateCatalog(JSON.parse(readFileSync(join(root, "automation/task-catalog.json"), "utf8")));
if (!catalogValidation.valid || !catalogValidation.catalog) die(`catalog invalid: ${catalogValidation.errors.join("; ")}`);
const catalog = catalogValidation.catalog!;
if (catalog.catalogVersion !== N2_011_TARGET_CATALOG_VERSION) {
  die(`catalog must be ${N2_011_TARGET_CATALOG_VERSION} (got ${catalog.catalogVersion})`);
}
const targetDefinition = catalog.tasks.find((task) => task.taskId === "TASK-N2-011");
if (!targetDefinition || targetDefinition.taskDefinitionVersion !== N2_011_TARGET_DEFINITION_VERSION) {
  die(`TASK-N2-011 catalog definition must be v${N2_011_TARGET_DEFINITION_VERSION}`);
}

// 2. Read automation authority and record both branch and queue-blob CAS values.
git("fetch", "origin", BRANCH, "--quiet");
const baseBranchSha = git("rev-parse", `origin/${BRANCH}`);
const queueBlobSha = git("rev-parse", `origin/${BRANCH}:${QUEUE_PATH}`);
const currentRunBlobSha = git("rev-parse", `origin/${BRANCH}:${CURRENT_RUN_PATH}`);
if (expectedQueueBlobSha && expectedQueueBlobSha !== queueBlobSha) {
  die(`queue blob CAS mismatch (${expectedQueueBlobSha} != ${queueBlobSha})`);
}
if (apply && !expectedQueueBlobSha) die("--apply requires --expected-queue-blob-sha");

const queueRaw = showBranchRaw(QUEUE_PATH);
const currentRunRaw = showBranchRaw(CURRENT_RUN_PATH);
const processedIntentsRaw = showBranchRaw(PROCESSED_INTENTS_PATH);
const processedRequestsRaw = showBranchRaw(PROCESSED_REQUESTS_PATH);
const processedIntentDigest = sha256(processedIntentsRaw);
const processedRequestDigest = sha256(processedRequestsRaw);
const now = new Date().toISOString();

const migration = migrateN2011QueueToV4(JSON.parse(queueRaw), JSON.parse(currentRunRaw), { now });
const report = {
  ...migration.plan,
  baseBranchSha,
  queueBlobSha,
  currentRunBlobSha,
  expectedQueueBlobSha,
  processedIntentDigestBefore: processedIntentDigest,
  processedRequestDigestBefore: processedRequestDigest,
  targetTaskId: "TASK-N2-011",
  targetDefinitionVersion: N2_011_TARGET_DEFINITION_VERSION,
  targetStatus: migration.nextQueue.tasks["TASK-N2-011"].status,
  targetAttemptCount: migration.nextQueue.tasks["TASK-N2-011"].attemptCount,
  targetMaxAttempts: migration.nextQueue.tasks["TASK-N2-011"].maxAttempts,
  n2013Status: migration.nextQueue.tasks["TASK-N2-013"].status,
  n2013AttemptCount: migration.nextQueue.tasks["TASK-N2-013"].attemptCount,
  generatedAt: now,
};
console.log(JSON.stringify(report, null, 2));

if (!migration.changed) {
  console.error("NO_CHANGE: TASK-N2-011 v4 queue migration is already applied and aligned");
  process.exit(0);
}
if (!apply) {
  console.error("DRY_RUN: migration is valid but not written; pass --apply with the exact queue blob SHA");
  process.exit(0);
}

// 3. Re-check CAS immediately before writing anything.
git("fetch", "origin", BRANCH, "--quiet");
const currentBranchSha = git("rev-parse", `origin/${BRANCH}`);
const currentQueueBlobSha = git("rev-parse", `origin/${BRANCH}:${QUEUE_PATH}`);
if (currentBranchSha !== baseBranchSha) die(`automation branch advanced (${baseBranchSha} -> ${currentBranchSha}); re-run`);
if (currentQueueBlobSha !== queueBlobSha) die(`queue blob advanced (${queueBlobSha} -> ${currentQueueBlobSha}); re-run`);

// 4. Materialize all control files, then atomically replace only queue/current-run.
for (const path of CONTROL_PATHS) {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  atomicWriteJson(destination, JSON.parse(showBranchRaw(path)), true);
}
atomicWriteJson(join(root, QUEUE_PATH), migration.nextQueue, true);
atomicWriteJson(join(root, CURRENT_RUN_PATH), migration.nextCurrentRun, true);

// 5. Readback + validators + idempotency proof.
for (const path of [QUEUE_PATH, CURRENT_RUN_PATH, PROCESSED_INTENTS_PATH, PROCESSED_REQUESTS_PATH]) {
  const readback = verifyJsonReadback(join(root, path));
  if (!readback.ok) die(`${path} readback failed: ${readback.errors.join("; ")}`);
}
const writtenQueue = JSON.parse(readFileSync(join(root, QUEUE_PATH), "utf8"));
const writtenCurrentRun = JSON.parse(readFileSync(join(root, CURRENT_RUN_PATH), "utf8"));
const writtenQueueValidation = validateQueueState(writtenQueue);
if (!writtenQueueValidation.valid || !writtenQueueValidation.state) {
  die(`written queue invalid: ${writtenQueueValidation.errors.join("; ")}`);
}
const writtenState = writtenQueueValidation.state!;
if (writtenState.catalogVersion !== N2_011_TARGET_CATALOG_VERSION) die("written catalogVersion mismatch");
if (writtenCurrentRun.stateVersion !== writtenState.stateVersion) die("queue/current-run stateVersion mismatch after write");
if (writtenCurrentRun.stateDigest !== computeStateDigest(writtenState)) die("current-run stateDigest mismatch after write");

const replay = migrateN2011QueueToV4(writtenQueue, writtenCurrentRun, { now: new Date(Date.parse(now) + 1).toISOString() });
if (replay.changed) die("migration replay must be NO_CHANGE");

const processedIntentsAfter = readFileSync(join(root, PROCESSED_INTENTS_PATH), "utf8");
const processedRequestsAfter = readFileSync(join(root, PROCESSED_REQUESTS_PATH), "utf8");
if (sha256(processedIntentsAfter) !== processedIntentDigest) die("processed-intents changed during migration");
if (sha256(processedRequestsAfter) !== processedRequestDigest) die("processed-requests changed during migration");

// 6. Append migration evidence; commit/push remains a separate CAS-aware step.
const evidencePath = join(root, "reports/automation/migrations", `n2-011-v4-cas-${baseBranchSha.slice(0, 12)}.json`);
mkdirSync(dirname(evidencePath), { recursive: true });
atomicWriteJson(evidencePath, {
  ...report,
  applied: true,
  appliedAt: now,
  processedIntentDigestAfter: sha256(processedIntentsAfter),
  processedRequestDigestAfter: sha256(processedRequestsAfter),
  replayResult: "NO_CHANGE",
  writtenQueueDigest: computeStateDigest(writtenState),
}, true);
writeFileSync(join(root, ".automation-branch-base"), `${baseBranchSha}\n`);
console.error(`READY_TO_COMMIT: ${evidencePath.replace(`${root}/`, "")} (run bash scripts/automation-commit.sh)`);

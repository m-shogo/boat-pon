import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { canonicalHash } from "../src/research-replay/canonical";
import { buildN2PitAuditSummary } from "../src/research-replay/n2PitAudit";
import { readN2PitAuditObservations } from "../src/research-replay/n2PitAuditReader";
import { readN2ObservationIngestReadiness } from "../src/research-replay/n2ObservationIngestReadinessReader";
import {
  computeStateDigest,
  validateCatalog,
  validateQueueState,
  type QueueState,
} from "../src/automation/taskCatalog";

const root = resolve(process.cwd());
const authorityRoot = resolve(requiredEnv("BOAT_PON_AUTOMATION_AUTHORITY_ROOT"));
const expectedAutomationSha = requiredEnv("BOAT_PON_EXPECTED_AUTOMATION_SHA");
const actualAutomationSha = requiredEnv("BOAT_PON_ACTUAL_AUTOMATION_SHA");
const expectedQueueBlobSha = requiredEnv("BOAT_PON_EXPECTED_QUEUE_BLOB_SHA");
const actualQueueBlobSha = requiredEnv("BOAT_PON_ACTUAL_QUEUE_BLOB_SHA");
const observedMainSha = requiredEnv("BOAT_PON_OBSERVED_MAIN_SHA");
const expectedMainSha = requiredEnv("BOAT_PON_EXPECTED_MAIN_SHA");
const evidencePath = resolve(process.env.BOAT_PON_PREFLIGHT_EVIDENCE_PATH
  ?? join(root, "reports/automation/validation/n2-011-final-preflight.json"));

const policy = readJson(join(root, "config/research-automation-policy.json"));
const canonicalRepo = resolve(String(policy.dataRoot ?? policy.repoPath ?? root));
const primaryDbPath = join(canonicalRepo, "data/boat.sqlite");
const sidecarDbPath = join(canonicalRepo, "data/research-replay.sqlite");
const manifestPath = join(authorityRoot, "reports/n2/n2-dataset-manifest.json");
const queuePath = join(authorityRoot, "automation/control/task-queue-state.json");
const currentRunPath = join(authorityRoot, "automation/control/current-run.json");
const processedIntentsPath = join(authorityRoot, "automation/control/processed-intents.json");
const processedRequestsPath = join(authorityRoot, "automation/control/processed-requests.json");
const plannerCandidatesPath = join(authorityRoot, "automation/control/planner-candidates.json");
const canaryVerificationPath = join(authorityRoot, "reports/n2/n2-official-program-canary-verification.json");

const checks: Record<string, { status: "PASS" | "BLOCKED"; detail: unknown }> = {};
const blockers: string[] = [];

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function addCheck(name: string, ok: boolean, detail: unknown, blockCode = name): void {
  checks[name] = { status: ok ? "PASS" : "BLOCKED", detail };
  if (!ok) blockers.push(blockCode);
}

function fileMeta(path: string): { exists: boolean; bytes: number | null; modifiedMs: number | null; walBytes: number } {
  const wal = `${path}-wal`;
  return {
    exists: existsSync(path),
    bytes: existsSync(path) ? statSync(path).size : null,
    modifiedMs: existsSync(path) ? statSync(path).mtimeMs : null,
    walBytes: existsSync(wal) ? statSync(wal).size : 0,
  };
}

function validateManifest(path: string, expectedDigest: string | null): {
  valid: boolean;
  errors: string[];
  outputDigest: string | null;
  pitCheckedRecordCount: number | null;
} {
  const errors: string[] = [];
  if (!existsSync(path)) return { valid: false, errors: ["MANIFEST_MISSING"], outputDigest: null, pitCheckedRecordCount: null };
  if (lstatSync(path).isSymbolicLink()) errors.push("MANIFEST_SYMLINK");
  if (statSync(path).size > 2_097_152) errors.push("MANIFEST_TOO_LARGE");
  const parsed = readJson(path) as Record<string, any>;
  if (parsed.datasetManifestVersion !== "n2-dataset-manifest-v2") errors.push("MANIFEST_VERSION_MISMATCH");
  if (parsed.readOnly !== true) errors.push("MANIFEST_NOT_READ_ONLY");
  if (parsed.holdoutExcludedFromResearchCohort !== true) errors.push("HOLDOUT_NOT_EXCLUDED");
  if (typeof parsed.outputDigest !== "string" || !/^[0-9a-f]{64}$/.test(parsed.outputDigest)) {
    errors.push("MANIFEST_OUTPUT_DIGEST_INVALID");
  } else {
    const digestable = { ...parsed };
    for (const key of ["runId", "requestId", "taskId", "executorVersion", "generatedAt", "outputDigest", "pitEvidence"]) {
      delete digestable[key];
    }
    if (canonicalHash(digestable) !== parsed.outputDigest) errors.push("MANIFEST_CORE_DIGEST_MISMATCH");
    if (expectedDigest !== null && parsed.outputDigest !== expectedDigest) errors.push("MANIFEST_QUEUE_DIGEST_MISMATCH");
  }
  const pit = parsed.pitEvidence;
  const candidates = parsed.inventoryTotals?.candidates;
  if (!pit || typeof pit !== "object") {
    errors.push("MANIFEST_PIT_ENVELOPE_MISSING");
  } else {
    if (pit.status !== "NOT_APPLICABLE") errors.push("MANIFEST_PIT_STATUS_INVALID");
    if (pit.validatorId !== "settlement-inventory-pit-applicability") errors.push("MANIFEST_PIT_VALIDATOR_ID_MISMATCH");
    if (pit.validatorVersion !== "v1") errors.push("MANIFEST_PIT_VALIDATOR_VERSION_MISMATCH");
    if (!Number.isInteger(pit.checkedRecordCount) || pit.checkedRecordCount !== candidates) errors.push("MANIFEST_PIT_CHECKED_COUNT_MISMATCH");
    for (const field of ["sameRaceViolationCount", "futureViolationCount", "ambiguousTimingCount"] as const) {
      if (pit[field] !== 0) errors.push(`MANIFEST_PIT_${field.toUpperCase()}_NONZERO`);
    }
    if (pit.evidencePath !== null || pit.evidenceDigest !== null) errors.push("MANIFEST_PIT_EVIDENCE_POINTER_INVALID");
    if (pit.notApplicableReason !== "settlement inventory does not join prediction-time features") {
      errors.push("MANIFEST_PIT_REASON_MISMATCH");
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    outputDigest: typeof parsed.outputDigest === "string" ? parsed.outputDigest : null,
    pitCheckedRecordCount: Number.isInteger(pit?.checkedRecordCount) ? pit.checkedRecordCount : null,
  };
}

function discoverUnprocessedN2011Intents(processedIntentIds: Set<string>): {
  equivalentPending: string[];
  superseded: string[];
  processed: string[];
} {
  const superseded = new Set<string>();
  const supersessionDir = join(root, "automation/requests/supersessions");
  if (existsSync(supersessionDir)) {
    for (const name of readdirSync(supersessionDir).filter((item) => item.endsWith(".json")).sort()) {
      const item = readJson(join(supersessionDir, name));
      if (item.taskId !== "TASK-N2-011") continue;
      for (const entry of item.supersededIntents ?? []) {
        if (typeof entry.intentId === "string") superseded.add(entry.intentId);
      }
    }
  }
  const pending: string[] = [];
  const processed: string[] = [];
  const intentDir = join(root, "automation/requests/intents");
  if (existsSync(intentDir)) {
    for (const name of readdirSync(intentDir).filter((item) => item.endsWith(".json")).sort()) {
      const item = readJson(join(intentDir, name));
      if (item.taskId !== "TASK-N2-011" || typeof item.intentId !== "string") continue;
      if (processedIntentIds.has(item.intentId)) processed.push(item.intentId);
      else if (!superseded.has(item.intentId)) pending.push(item.intentId);
    }
  }
  return { equivalentPending: pending, superseded: [...superseded].sort(), processed: processed.sort() };
}

function canonicalWorktreeStatus(): string[] {
  if (!existsSync(join(canonicalRepo, ".git"))) return ["CANONICAL_REPO_NOT_FOUND"];
  const output = execFileSync("git", ["-C", canonicalRepo, "status", "--porcelain", "--untracked-files=all"], {
    encoding: "utf8",
  }).trim();
  return output ? output.split("\n") : [];
}

function activeAutomationLock(): { active: boolean; detail: unknown } {
  const lockPath = join(canonicalRepo, String(policy.lock?.path ?? "data/tmp/automation/research.lock.json"));
  if (!existsSync(lockPath)) return { active: false, detail: { lockPath, exists: false } };
  try {
    const lock = readJson(lockPath);
    const at = Date.parse(String(lock.heartbeatAt ?? lock.acquiredAt ?? ""));
    const ageSeconds = Number.isFinite(at) ? Math.floor((Date.now() - at) / 1000) : null;
    const staleAfterSeconds = Number(policy.lock?.staleAfterSeconds ?? 7200);
    return {
      active: ageSeconds === null || ageSeconds < staleAfterSeconds,
      detail: { lockPath, exists: true, ageSeconds, staleAfterSeconds, owner: lock.owner ?? null },
    };
  } catch (error) {
    return { active: true, detail: { lockPath, exists: true, parseError: error instanceof Error ? error.message : String(error) } };
  }
}

const startedAt = new Date().toISOString();
const primaryBefore = fileMeta(primaryDbPath);
const sidecarBefore = fileMeta(sidecarDbPath);

try {
  addCheck("mainAuthority", observedMainSha === expectedMainSha, { observedMainSha, expectedMainSha }, "MAIN_AUTHORITY_DRIFT");
  addCheck("automationAuthority", actualAutomationSha === expectedAutomationSha, {
    actualAutomationSha,
    expectedAutomationSha,
  }, "AUTOMATION_AUTHORITY_DRIFT");
  addCheck("queueBlobAuthority", actualQueueBlobSha === expectedQueueBlobSha, {
    actualQueueBlobSha,
    expectedQueueBlobSha,
  }, "QUEUE_BLOB_DRIFT");

  const catalogValidation = validateCatalog(readJson(join(root, "automation/task-catalog.json")));
  addCheck("catalogValidation", catalogValidation.valid && catalogValidation.catalog?.catalogVersion === "2026-08-06-n2-governance-v8", {
    valid: catalogValidation.valid,
    errors: catalogValidation.errors,
    catalogVersion: catalogValidation.catalog?.catalogVersion ?? null,
  }, "CATALOG_INVALID");

  const queueValidation = validateQueueState(readJson(queuePath));
  const queue = queueValidation.state as QueueState | undefined;
  addCheck("queueValidation", queueValidation.valid && Boolean(queue), { errors: queueValidation.errors }, "QUEUE_INVALID");
  if (!queue) throw new Error(`QUEUE_INVALID:${queueValidation.errors.join(";")}`);
  const currentRun = readJson(currentRunPath);
  const queueDigest = computeStateDigest(queue);
  addCheck("queueCurrentRunAlignment", queue.stateVersion === 48
    && currentRun.stateVersion === 48
    && currentRun.stateDigest === queueDigest,
  {
    queueStateVersion: queue.stateVersion,
    currentRunStateVersion: currentRun.stateVersion,
    currentRunStateDigest: currentRun.stateDigest,
    computedQueueDigest: queueDigest,
  }, "QUEUE_CURRENT_RUN_MISMATCH");

  const n2010 = queue.tasks["TASK-N2-010"];
  const n2011 = queue.tasks["TASK-N2-011"];
  const n2013 = queue.tasks["TASK-N2-013"];
  addCheck("taskState", n2010?.status === "PASS"
    && n2011?.status === "READY"
    && n2011.taskDefinitionVersion === 4
    && n2011.attemptCount === 2
    && n2011.maxAttempts === 3
    && n2013?.status === "PASS"
    && n2013.attemptCount === 3
    && n2013.maxAttempts === 3,
  { n2010, n2011, n2013 }, "TASK_STATE_NOT_READY");
  const inFlight = Object.entries(queue.tasks)
    .filter(([, task]) => task.status === "CLAIMED" || task.status === "RUNNING")
    .map(([taskId, task]) => ({ taskId, status: task.status }));
  addCheck("noInFlightTask", inFlight.length === 0, { inFlight }, "TASK_ALREADY_IN_FLIGHT");

  const processedIntents = readJson(processedIntentsPath);
  const processedRequests = readJson(processedRequestsPath);
  const processedIntentIds = new Set<string>(processedIntents.intentIds ?? []);
  const intentState = discoverUnprocessedN2011Intents(processedIntentIds);
  addCheck("noEquivalentUnprocessedIntent", intentState.equivalentPending.length === 0, {
    ...intentState,
    processedIntentCount: processedIntentIds.size,
    processedRequestCount: (processedRequests.requestIds ?? []).length,
    processedIntentDigest: sha256(readFileSync(processedIntentsPath)),
    processedRequestDigest: sha256(readFileSync(processedRequestsPath)),
    plannerCandidatesDigest: sha256(readFileSync(plannerCandidatesPath)),
  }, "EQUIVALENT_UNPROCESSED_INTENT");

  const dirty = canonicalWorktreeStatus();
  addCheck("canonicalWorktreeClean", dirty.length === 0, { canonicalRepo, dirty }, "CANONICAL_WORKTREE_DIRTY");
  const lock = activeAutomationLock();
  addCheck("automationLockFree", !lock.active, lock.detail, "AUTOMATION_LOCK_ACTIVE");
  const emergencyPath = join(canonicalRepo, String(policy.guards?.emergencyStopPath ?? "automation/EMERGENCY_STOP"));
  const pausePath = join(canonicalRepo, String(policy.guards?.pausePath ?? "automation/PAUSED"));
  addCheck("automationNotPaused", !existsSync(emergencyPath) && !existsSync(pausePath), {
    emergencyPath,
    emergencyStop: existsSync(emergencyPath),
    pausePath,
    paused: existsSync(pausePath),
  }, "AUTOMATION_PAUSED_OR_STOPPED");

  const fs = statfsSync(canonicalRepo);
  const freeBytes = Number(fs.bavail) * Number(fs.bsize);
  const minFreeBytes = Number(policy.guards?.minFreeDiskBytes ?? 21_474_836_480);
  addCheck("diskCapacity", freeBytes >= minFreeBytes, { freeBytes, minFreeBytes }, "INSUFFICIENT_DISK");

  addCheck("dbFilesPresentAndQuiescent", primaryBefore.exists && sidecarBefore.exists
    && primaryBefore.walBytes === 0 && sidecarBefore.walBytes === 0,
  { primary: primaryBefore, sidecar: sidecarBefore }, "ACTIVE_WAL_OR_DB_MISSING");

  const manifest = validateManifest(manifestPath, n2010?.resultDigest ?? null);
  addCheck("datasetManifest", manifest.valid, {
    path: basename(manifestPath),
    ...manifest,
    materializedOutsideWorktree: !manifestPath.startsWith(`${root}/`),
  }, "DATASET_MANIFEST_INVALID");

  const readiness = readN2ObservationIngestReadiness({ primaryDbPath, sidecarDbPath });
  addCheck("rolloutSafety", readiness.input.rollout.shadowWriteEnabled === false
    && readiness.input.rollout.killSwitchEngaged === false
    && readiness.input.rollout.operationalGcEnabled === false,
  readiness.input.rollout, "ROLLOUT_SAFETY_NOT_OFF");
  addCheck("officialProgramCanaryMaintained",
    readiness.input.sidecar.officialProgramObservationCount === 20
    && readiness.input.sidecar.trifectaMarketObservationCount === 0
    && readiness.input.sidecar.captureAttemptCount === 20,
  readiness.input.sidecar, "OFFICIAL_PROGRAM_CANARY_COUNT_MISMATCH");

  const canaryVerification = readJson(canaryVerificationPath);
  addCheck("canaryVerificationAuthority",
    canaryVerification.status === "PASS"
    && canaryVerification.manifestDigest === "151c34786e29ca80838da0fe3b2eb3326ee343d0a3656e8f20666af14d1b3a85"
    && canaryVerification.observations?.officialProgramCount === 20
    && canaryVerification.observations?.trifectaMarketCount === 0
    && canaryVerification.observations?.captureAttemptCount === 20
    && canaryVerification.approval?.currentCode === "APPROVAL_REVOKED"
    && canaryVerification.rollout?.globalShadowWriteEnabled === false
    && canaryVerification.primarySourceVerification?.matchingSelectedRows === 20,
  canaryVerification, "CANARY_VERIFICATION_MISMATCH");

  const read = readN2PitAuditObservations({ primaryDbPath, sidecarDbPath });
  const pit = buildN2PitAuditSummary(read.observations);
  const expectedPit = pit.status === "PASS"
    && pit.dataStatus === "REAL_DATA"
    && pit.auditedObservationCount === 20
    && pit.verifiedSafeCount === 20
    && pit.checkedFeatureCount === 20
    && pit.checkedOddsCount === 0
    && pit.sameRaceViolationCount === 0
    && pit.futureViolationCount === 0
    && pit.ambiguousTimingCount === 0
    && pit.postRaceFeatureRead === false
    && read.returnedObservationCount === 20
    && read.truncated === false
    && read.readOnly === true
    && read.queryOnly === true;
  addCheck("pitReadOnlyPreview", expectedPit, { ...pit, reader: {
    returnedObservationCount: read.returnedObservationCount,
    truncated: read.truncated,
    readOnly: read.readOnly,
    queryOnly: read.queryOnly,
    sourceTypes: read.sourceTypes,
  } }, "PIT_PREVIEW_MISMATCH");
} catch (error) {
  blockers.push("PREFLIGHT_EXCEPTION");
  checks.preflightException = {
    status: "BLOCKED",
    detail: error instanceof Error ? { message: error.message, stack: error.stack ?? null } : String(error),
  };
}

const primaryAfter = fileMeta(primaryDbPath);
const sidecarAfter = fileMeta(sidecarDbPath);
const dbUnchanged = JSON.stringify(primaryBefore) === JSON.stringify(primaryAfter)
  && JSON.stringify(sidecarBefore) === JSON.stringify(sidecarAfter);
addCheck("dbMetadataUnchanged", dbUnchanged, {
  primaryBefore,
  primaryAfter,
  sidecarBefore,
  sidecarAfter,
  primaryDbWriteCount: 0,
  sidecarWriteCount: 0,
}, "DB_METADATA_CHANGED");

const uniqueBlockers = [...new Set(blockers)];
const report = {
  evidenceSchemaVersion: "n2-011-final-preflight-v1",
  status: uniqueBlockers.length === 0 ? "PASS" : "BLOCKED",
  taskId: "TASK-N2-011",
  taskDefinitionVersion: 4,
  expectedAttempt: 3,
  safetyLevel: "L0",
  startedAt,
  completedAt: new Date().toISOString(),
  executionLocation: "Mac self-hosted",
  authority: {
    mainSha: observedMainSha,
    automationSha: actualAutomationSha,
    queueBlobSha: actualQueueBlobSha,
  },
  materialization: {
    authorityRoot,
    manifestPath,
    manifestInRunnerTemp: authorityRoot.includes("_temp") || authorityRoot.includes("/tmp/"),
    worktreeManifestWritten: false,
  },
  checks,
  blockers: uniqueBlockers,
  primaryDbWriteCount: 0,
  sidecarWriteCount: 0,
  productionApplyExecuted: false,
  approvalCreated: false,
  intentCreated: false,
  taskAttemptConsumed: false,
};
mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (report.status !== "PASS") process.exitCode = 1;

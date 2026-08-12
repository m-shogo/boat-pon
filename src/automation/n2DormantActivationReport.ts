import { canonicalHash } from "../research-replay/canonical";
import {
  N2_MARKET_BASELINE_MIN_SETTLED_RACES,
  N2_MARKET_BASELINE_READINESS_STATUSES,
  N2_MARKET_BASELINE_READINESS_VERSION,
  classifyN2MarketBaselineReadiness,
  type N2MarketBaselineReadinessReport,
} from "../research-replay/n2MarketBaselineReadiness";
import {
  N2_DORMANT_TASKS,
  buildN2DormantActivationPlan,
  type N2DormantTaskId,
} from "./n2DormantActivationContract";
import { TASK_STATUSES } from "./researchOrchestrator";
import { DEFAULT_STATUSES } from "./taskCatalog";

export const N2_DORMANT_ACTIVATION_REPORT_VERSION =
  "n2-dormant-activation-report-v1" as const;

const N2_DORMANT_TASK_TYPES: Record<N2DormantTaskId, string> = {
  "TASK-N2-020": "baseline-market",
  "TASK-N2-021": "baseline-historical",
  "TASK-N2-022": "baseline-common-cohort",
  "TASK-N2-030": "evaluation-metrics",
  "TASK-N2-040": "edge-hypothesis-scan",
  "TASK-N2-041": "edge-historical-test",
  "TASK-N2-042": "confounder-audit",
};

export type N2ActivationCatalogTask = {
  taskId: string;
  taskType: string;
  defaultStatus: string;
};

export type N2ActivationQueueTask = {
  status: string;
  attemptCount: number;
  maxAttempts: number;
};

export type N2DormantActivationReport = {
  reportVersion: typeof N2_DORMANT_ACTIVATION_REPORT_VERSION;
  status: "PASS" | "CONFLICT";
  stage: string;
  blockers: string[];
  readiness: {
    status: string;
    n2TaskReady: boolean;
    minimumSettledRaceCount: number;
    acceptedT5RaceCount: number;
    settledAcceptedT5RaceCount: number;
    integrityBlockedRaceCount: number;
  };
  tasks: Record<N2DormantTaskId, {
    status: string;
    attemptCount: number;
    maxAttempts: number;
    catalogDefaultStatus: string;
    runtimeExecutorRegistered: boolean;
  }>;
  activationActions: ReturnType<typeof buildN2DormantActivationPlan>["activationActions"];
  activationPlanningAttemptDelta: 0;
  automaticMutationAuthorized: false;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  publicPublishAuthorized: false;
  automatedBettingAuthorized: false;
  productionApplyAuthorized: false;
  databaseWriteCount: 0;
  networkRequestCount: 0;
  rawOddsValuesReadByPlanner: false;
  outputDigest: string;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function buildN2DormantActivationReport(input: {
  readiness: N2MarketBaselineReadinessReport;
  catalogTasks: N2ActivationCatalogTask[];
  queueTasks: Record<string, N2ActivationQueueTask | undefined>;
  runtimeRegisteredByTaskId: Record<string, boolean | undefined>;
}): N2DormantActivationReport {
  const blockers: string[] = [];
  const catalogById = new Map(input.catalogTasks.map((task) => [task.taskId, task]));
  if (catalogById.size !== input.catalogTasks.length) blockers.push("CATALOG_DUPLICATE_TASK_ID");

  const { outputDigest: readinessOutputDigest, ...readinessCore } = input.readiness;
  if (typeof readinessOutputDigest !== "string" || canonicalHash(readinessCore) !== readinessOutputDigest) {
    blockers.push("READINESS_OUTPUT_DIGEST_INVALID");
  }
  if (input.readiness.reportVersion !== N2_MARKET_BASELINE_READINESS_VERSION
    || input.readiness.n2TaskId !== "TASK-N2-020") {
    blockers.push("READINESS_IDENTITY_INVALID");
  }
  if (!N2_MARKET_BASELINE_READINESS_STATUSES.includes(
    input.readiness.status as (typeof N2_MARKET_BASELINE_READINESS_STATUSES)[number],
  )) {
    blockers.push("READINESS_STATUS_INVALID");
  }
  if (input.readiness.automaticPromotionAuthorized !== false
    || input.readiness.currentBuyConnectionAuthorized !== false
    || input.readiness.lineConnectionAuthorized !== false
    || input.readiness.publicPublishAuthorized !== false
    || input.readiness.databaseWriteAuthorized !== false
    || input.readiness.automatedBettingAuthorized !== false
    || input.readiness.productionApplyAuthorized !== false) {
    blockers.push("READINESS_PROTECTED_AUTHORITY_INVALID");
  }
  const readinessBlockersValid = Array.isArray(input.readiness.blockers)
    && input.readiness.blockers.every((blocker) => typeof blocker === "string");
  const readinessBlockers = readinessBlockersValid ? input.readiness.blockers : [];
  if (!readinessBlockersValid) blockers.push("READINESS_BLOCKERS_INVALID");
  const readinessSaysReady = input.readiness.status === "READY_FOR_N2_020";
  const readinessCountsValid = Number.isSafeInteger(input.readiness.minimumSettledRaceCount)
    && input.readiness.minimumSettledRaceCount >= 1
    && Number.isSafeInteger(input.readiness.acceptedT5RaceCount)
    && input.readiness.acceptedT5RaceCount >= 0
    && Number.isSafeInteger(input.readiness.settledAcceptedT5RaceCount)
    && input.readiness.settledAcceptedT5RaceCount >= 0
    && input.readiness.settledAcceptedT5RaceCount <= input.readiness.acceptedT5RaceCount
    && Number.isSafeInteger(input.readiness.integrityBlockedRaceCount)
    && input.readiness.integrityBlockedRaceCount >= 0;
  if (!readinessCountsValid) blockers.push("READINESS_COUNTS_INVALID");
  if (input.readiness.minimumSettledRaceCount !== N2_MARKET_BASELINE_MIN_SETTLED_RACES) {
    blockers.push("READINESS_MINIMUM_SETTLED_RACES_MISMATCH");
  }
  if (readinessCountsValid) {
    const expectedStatus = classifyN2MarketBaselineReadiness({
      blockerCount: readinessBlockers.length,
      integrityBlockedRaceCount: input.readiness.integrityBlockedRaceCount,
      acceptedT5RaceCount: input.readiness.acceptedT5RaceCount,
      settledAcceptedT5RaceCount: input.readiness.settledAcceptedT5RaceCount,
      minimumSettledRaceCount: input.readiness.minimumSettledRaceCount,
    });
    if (input.readiness.status !== expectedStatus) blockers.push("READINESS_STATUS_COUNTS_INCONSISTENT");
  }
  if (readinessSaysReady && readinessCountsValid
    && (input.readiness.settledAcceptedT5RaceCount < input.readiness.minimumSettledRaceCount
      || input.readiness.integrityBlockedRaceCount > 0)) {
    blockers.push("READINESS_READY_COUNTS_INCONSISTENT");
  }
  if (input.readiness.n2TaskReady !== readinessSaysReady) {
    blockers.push("READINESS_TASK_READY_STATE_INCONSISTENT");
  }
  if (readinessBlockers.length > 0 && input.readiness.status !== "BLOCKED") {
    blockers.push("READINESS_BLOCKERS_WITH_NONBLOCKED_STATUS");
  }
  if (input.readiness.status === "BLOCKED" && readinessBlockers.length === 0
    && input.readiness.integrityBlockedRaceCount === 0) {
    blockers.push("READINESS_BLOCKED_WITHOUT_BLOCKER");
  }

  const taskStatuses: Record<string, string> = {};
  const catalogDefaultStatuses: Record<string, string> = {};
  const runtimeExecutorRegistered: Record<string, boolean> = {};
  const tasks = {} as N2DormantActivationReport["tasks"];

  for (const taskId of N2_DORMANT_TASKS) {
    const catalogTask = catalogById.get(taskId);
    const queueTask = input.queueTasks[taskId];
    const runtimeRegistrationValue = input.runtimeRegisteredByTaskId[taskId] as unknown;
    const registered = runtimeRegistrationValue === true;
    if (!catalogTask) blockers.push(`${taskId}:CATALOG_TASK_MISSING`);
    if (!queueTask) blockers.push(`${taskId}:QUEUE_TASK_MISSING`);
    if (catalogTask && catalogTask.taskType !== N2_DORMANT_TASK_TYPES[taskId]) {
      blockers.push(`${taskId}:CATALOG_TASK_TYPE_MISMATCH`);
    }
    if (catalogTask && !DEFAULT_STATUSES.includes(catalogTask.defaultStatus as (typeof DEFAULT_STATUSES)[number])) {
      blockers.push(`${taskId}:CATALOG_DEFAULT_STATUS_INVALID`);
    }
    if (queueTask && !TASK_STATUSES.includes(queueTask.status as (typeof TASK_STATUSES)[number])) {
      blockers.push(`${taskId}:QUEUE_STATUS_INVALID`);
    }
    if (runtimeRegistrationValue === undefined) {
      blockers.push(`${taskId}:RUNTIME_REGISTRATION_STATE_MISSING`);
    } else if (typeof runtimeRegistrationValue !== "boolean") {
      blockers.push(`${taskId}:RUNTIME_REGISTRATION_STATE_INVALID`);
    }
    if (queueTask && ["READY", "CLAIMED", "RUNNING", "CHECKPOINTED"].includes(queueTask.status)
      && catalogTask?.defaultStatus === "BLOCKED_EXECUTOR_PENDING"
      && !registered) {
      blockers.push(`${taskId}:QUEUE_ACTIVATED_WHILE_CATALOG_AND_EXECUTOR_DORMANT`);
    }
    if (queueTask && (!Number.isSafeInteger(queueTask.attemptCount) || queueTask.attemptCount < 0)) blockers.push(`${taskId}:ATTEMPT_COUNT_INVALID`);
    if (queueTask && (!Number.isSafeInteger(queueTask.maxAttempts) || queueTask.maxAttempts < 1 || queueTask.attemptCount > queueTask.maxAttempts)) blockers.push(`${taskId}:MAX_ATTEMPTS_INVALID`);
    if (queueTask?.status === "BLOCKED_EXECUTOR_PENDING"
      && catalogTask?.defaultStatus === "BLOCKED_EXECUTOR_PENDING"
      && !registered
      && queueTask.attemptCount !== 0) {
      blockers.push(`${taskId}:DORMANT_ATTEMPT_COUNT_NOT_ZERO`);
    }
    taskStatuses[taskId] = queueTask?.status ?? "UNKNOWN";
    catalogDefaultStatuses[taskId] = catalogTask?.defaultStatus ?? "UNKNOWN";
    runtimeExecutorRegistered[taskId] = registered;
    tasks[taskId] = {
      status: queueTask?.status ?? "UNKNOWN",
      attemptCount: queueTask?.attemptCount ?? 0,
      maxAttempts: queueTask?.maxAttempts ?? 0,
      catalogDefaultStatus: catalogTask?.defaultStatus ?? "UNKNOWN",
      runtimeExecutorRegistered: registered,
    };
  }

  const plan = buildN2DormantActivationPlan({
    readinessStatus: input.readiness.status,
    taskStatuses,
    catalogDefaultStatuses,
    runtimeExecutorRegistered,
  });
  blockers.push(...plan.blockers);
  if (input.readiness.status === "BLOCKED") blockers.push(...readinessBlockers.map((blocker) => `READINESS:${blocker}`));

  const core = {
    reportVersion: N2_DORMANT_ACTIVATION_REPORT_VERSION,
    status: blockers.length === 0 && plan.status === "PASS" ? "PASS" as const : "CONFLICT" as const,
    stage: blockers.length === 0 ? plan.stage : "CONFLICT",
    blockers: unique(blockers),
    readiness: {
      status: input.readiness.status,
      n2TaskReady: input.readiness.n2TaskReady,
      minimumSettledRaceCount: input.readiness.minimumSettledRaceCount,
      acceptedT5RaceCount: input.readiness.acceptedT5RaceCount,
      settledAcceptedT5RaceCount: input.readiness.settledAcceptedT5RaceCount,
      integrityBlockedRaceCount: input.readiness.integrityBlockedRaceCount,
    },
    tasks,
    activationActions: blockers.length === 0 ? plan.activationActions : [],
    activationPlanningAttemptDelta: 0 as const,
    automaticMutationAuthorized: false as const,
    currentBuyConnectionAuthorized: false as const,
    lineConnectionAuthorized: false as const,
    publicPublishAuthorized: false as const,
    automatedBettingAuthorized: false as const,
    productionApplyAuthorized: false as const,
    databaseWriteCount: 0 as const,
    networkRequestCount: 0 as const,
    rawOddsValuesReadByPlanner: false as const,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

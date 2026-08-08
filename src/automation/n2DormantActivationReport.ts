import { canonicalHash } from "../research-replay/canonical";
import type { N2MarketBaselineReadinessReport } from "../research-replay/n2MarketBaselineReadiness";
import {
  N2_DORMANT_TASKS,
  buildN2DormantActivationPlan,
  type N2DormantTaskId,
} from "./n2DormantActivationContract";

export const N2_DORMANT_ACTIVATION_REPORT_VERSION =
  "n2-dormant-activation-report-v1" as const;

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

  const taskStatuses: Record<string, string> = {};
  const catalogDefaultStatuses: Record<string, string> = {};
  const runtimeExecutorRegistered: Record<string, boolean> = {};
  const tasks = {} as N2DormantActivationReport["tasks"];

  for (const taskId of N2_DORMANT_TASKS) {
    const catalogTask = catalogById.get(taskId);
    const queueTask = input.queueTasks[taskId];
    if (!catalogTask) blockers.push(`${taskId}:CATALOG_TASK_MISSING`);
    if (!queueTask) blockers.push(`${taskId}:QUEUE_TASK_MISSING`);
    if (queueTask && (!Number.isSafeInteger(queueTask.attemptCount) || queueTask.attemptCount < 0)) blockers.push(`${taskId}:ATTEMPT_COUNT_INVALID`);
    if (queueTask && (!Number.isSafeInteger(queueTask.maxAttempts) || queueTask.maxAttempts < 1 || queueTask.attemptCount > queueTask.maxAttempts)) blockers.push(`${taskId}:MAX_ATTEMPTS_INVALID`);
    const registered = input.runtimeRegisteredByTaskId[taskId] === true;
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
  if (input.readiness.status === "BLOCKED") blockers.push(...input.readiness.blockers.map((blocker) => `READINESS:${blocker}`));

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

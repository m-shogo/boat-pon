import { canonicalHash } from "../research-replay/canonical";

export const N2_DORMANT_ACTIVATION_CONTRACT_VERSION =
  "n2-dormant-activation-contract-v1" as const;

export const N2_DORMANT_TASKS = [
  "TASK-N2-020",
  "TASK-N2-021",
  "TASK-N2-022",
  "TASK-N2-030",
] as const;

export type N2DormantTaskId = typeof N2_DORMANT_TASKS[number];
export type N2DormantTaskStatus =
  | "READY"
  | "PASS"
  | "BLOCKED"
  | "BLOCKED_EXECUTOR_PENDING"
  | "FAILED"
  | "RUNNING"
  | "UNKNOWN";

export type N2DormantActivationStage =
  | "WAITING_PRIVATE_COHORT"
  | "ACTIVATE_BASELINES"
  | "WAITING_BASELINES_PASS"
  | "ACTIVATE_COMMON_COHORT"
  | "WAITING_COMMON_COHORT_PASS"
  | "ACTIVATE_METRICS"
  | "COMPLETE"
  | "CONFLICT";

export type N2DormantActivationAction = {
  activationGroupId: "n2-baselines" | "n2-common-cohort" | "n2-metrics";
  taskIds: N2DormantTaskId[];
  requiredAtomicChanges: Array<
    | "register_executor"
    | "change_catalog_default_status"
    | "update_automation_state"
  >;
  mayConsumeAttemptAfterActivation: true;
  automaticMutationAuthorized: false;
};

export type N2DormantActivationPlan = {
  contractVersion: typeof N2_DORMANT_ACTIVATION_CONTRACT_VERSION;
  status: "PASS" | "CONFLICT";
  stage: N2DormantActivationStage;
  blockers: string[];
  readinessStatus: string;
  activationActions: N2DormantActivationAction[];
  taskStatuses: Record<N2DormantTaskId, N2DormantTaskStatus>;
  catalogDefaultStatuses: Record<N2DormantTaskId, string>;
  runtimeExecutorRegistered: Record<N2DormantTaskId, boolean>;
  invariants: {
    blockedExecutorPendingRequiresUnregisteredExecutor: true;
    executorRegistrationAndCatalogActivationMustBeAtomic: true;
    baselinePairActivatesTogether: true;
    commonCohortRequiresBothBaselinesPass: true;
    metricsRequiresCommonCohortPass: true;
    activationPlanningConsumesAttempt: false;
  };
  automaticPromotionAuthorized: false;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  publicPublishAuthorized: false;
  databaseWriteAuthorized: false;
  automatedBettingAuthorized: false;
  productionApplyAuthorized: false;
  outputDigest: string;
};

function normalizeStatus(value: string | undefined): N2DormantTaskStatus {
  switch (value) {
    case "READY":
    case "PASS":
    case "BLOCKED":
    case "BLOCKED_EXECUTOR_PENDING":
    case "FAILED":
    case "RUNNING":
      return value;
    default:
      return "UNKNOWN";
  }
}

function action(
  activationGroupId: N2DormantActivationAction["activationGroupId"],
  taskIds: N2DormantTaskId[],
): N2DormantActivationAction {
  return {
    activationGroupId,
    taskIds,
    requiredAtomicChanges: [
      "register_executor",
      "change_catalog_default_status",
      "update_automation_state",
    ],
    mayConsumeAttemptAfterActivation: true,
    automaticMutationAuthorized: false,
  };
}

export function buildN2DormantActivationPlan(input: {
  readinessStatus: string;
  taskStatuses: Readonly<Record<string, string | undefined>>;
  catalogDefaultStatuses: Readonly<Record<string, string | undefined>>;
  runtimeExecutorRegistered: Readonly<Record<string, boolean | undefined>>;
}): N2DormantActivationPlan {
  const taskStatuses = Object.fromEntries(
    N2_DORMANT_TASKS.map((taskId) => [taskId, normalizeStatus(input.taskStatuses[taskId])]),
  ) as Record<N2DormantTaskId, N2DormantTaskStatus>;
  const catalogDefaultStatuses = Object.fromEntries(
    N2_DORMANT_TASKS.map((taskId) => [
      taskId,
      input.catalogDefaultStatuses[taskId] ?? "UNKNOWN",
    ]),
  ) as Record<N2DormantTaskId, string>;
  const runtimeExecutorRegistered = Object.fromEntries(
    N2_DORMANT_TASKS.map((taskId) => [taskId, input.runtimeExecutorRegistered[taskId] === true]),
  ) as Record<N2DormantTaskId, boolean>;

  const blockers: string[] = [];
  for (const taskId of N2_DORMANT_TASKS) {
    const defaultStatus = catalogDefaultStatuses[taskId];
    const registered = runtimeExecutorRegistered[taskId];
    if (defaultStatus === "BLOCKED_EXECUTOR_PENDING" && registered) {
      blockers.push(`${taskId}:REGISTERED_WHILE_BLOCKED_EXECUTOR_PENDING`);
    }
    if (defaultStatus !== "BLOCKED_EXECUTOR_PENDING" && !registered
      && taskStatuses[taskId] !== "PASS") {
      blockers.push(`${taskId}:CATALOG_ACTIVATED_WITHOUT_EXECUTOR`);
    }
  }

  const baseline020Pass = taskStatuses["TASK-N2-020"] === "PASS";
  const baseline021Pass = taskStatuses["TASK-N2-021"] === "PASS";
  if (baseline020Pass !== baseline021Pass) {
    blockers.push("BASELINE_PAIR_PASS_STATE_DIVERGED");
  }
  if (taskStatuses["TASK-N2-022"] === "PASS" && !(baseline020Pass && baseline021Pass)) {
    blockers.push("COMMON_COHORT_PASS_WITHOUT_BOTH_BASELINES_PASS");
  }
  if (taskStatuses["TASK-N2-030"] === "PASS" && taskStatuses["TASK-N2-022"] !== "PASS") {
    blockers.push("METRICS_PASS_WITHOUT_COMMON_COHORT_PASS");
  }

  let stage: N2DormantActivationStage;
  let activationActions: N2DormantActivationAction[] = [];
  if (blockers.length > 0) {
    stage = "CONFLICT";
  } else if (taskStatuses["TASK-N2-030"] === "PASS") {
    stage = "COMPLETE";
  } else if (taskStatuses["TASK-N2-022"] === "PASS") {
    if (runtimeExecutorRegistered["TASK-N2-030"]
      || catalogDefaultStatuses["TASK-N2-030"] !== "BLOCKED_EXECUTOR_PENDING") {
      stage = "WAITING_COMMON_COHORT_PASS";
    } else {
      stage = "ACTIVATE_METRICS";
      activationActions = [action("n2-metrics", ["TASK-N2-030"])];
    }
  } else if (baseline020Pass && baseline021Pass) {
    if (runtimeExecutorRegistered["TASK-N2-022"]
      || catalogDefaultStatuses["TASK-N2-022"] !== "BLOCKED_EXECUTOR_PENDING") {
      stage = "WAITING_COMMON_COHORT_PASS";
    } else {
      stage = "ACTIVATE_COMMON_COHORT";
      activationActions = [action("n2-common-cohort", ["TASK-N2-022"])];
    }
  } else if (input.readinessStatus === "READY_FOR_N2_020") {
    const bothDormant = ["TASK-N2-020", "TASK-N2-021"].every((taskId) =>
      catalogDefaultStatuses[taskId as N2DormantTaskId] === "BLOCKED_EXECUTOR_PENDING"
      && !runtimeExecutorRegistered[taskId as N2DormantTaskId],
    );
    if (bothDormant) {
      stage = "ACTIVATE_BASELINES";
      activationActions = [action("n2-baselines", ["TASK-N2-020", "TASK-N2-021"])];
    } else {
      stage = "WAITING_BASELINES_PASS";
    }
  } else {
    stage = "WAITING_PRIVATE_COHORT";
  }

  const core = {
    contractVersion: N2_DORMANT_ACTIVATION_CONTRACT_VERSION,
    status: blockers.length === 0 ? "PASS" as const : "CONFLICT" as const,
    stage,
    blockers: [...new Set(blockers)].sort(),
    readinessStatus: input.readinessStatus,
    activationActions,
    taskStatuses,
    catalogDefaultStatuses,
    runtimeExecutorRegistered,
    invariants: {
      blockedExecutorPendingRequiresUnregisteredExecutor: true as const,
      executorRegistrationAndCatalogActivationMustBeAtomic: true as const,
      baselinePairActivatesTogether: true as const,
      commonCohortRequiresBothBaselinesPass: true as const,
      metricsRequiresCommonCohortPass: true as const,
      activationPlanningConsumesAttempt: false as const,
    },
    automaticPromotionAuthorized: false as const,
    currentBuyConnectionAuthorized: false as const,
    lineConnectionAuthorized: false as const,
    publicPublishAuthorized: false as const,
    databaseWriteAuthorized: false as const,
    automatedBettingAuthorized: false as const,
    productionApplyAuthorized: false as const,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

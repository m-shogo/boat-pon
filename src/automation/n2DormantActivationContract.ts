import { canonicalHash } from "../research-replay/canonical";

export const N2_DORMANT_ACTIVATION_CONTRACT_VERSION =
  "n2-dormant-activation-contract-v2" as const;

export const N2_DORMANT_TASKS = [
  "TASK-N2-020",
  "TASK-N2-021",
  "TASK-N2-022",
  "TASK-N2-030",
  "TASK-N2-040",
  "TASK-N2-041",
  "TASK-N2-042",
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
  | "WAITING_METRICS_PASS"
  | "ACTIVATE_EDGE_SCAN"
  | "WAITING_EDGE_SCAN_PASS"
  | "ACTIVATE_HISTORICAL_TEST"
  | "WAITING_HISTORICAL_TEST_PASS"
  | "ACTIVATE_CONFOUNDER_AUDIT"
  | "WAITING_CONFOUNDER_AUDIT_PASS"
  | "COMPLETE"
  | "CONFLICT";

export type N2DormantActivationAction = {
  activationGroupId:
    | "n2-baselines"
    | "n2-common-cohort"
    | "n2-metrics"
    | "n2-edge-scan"
    | "n2-historical-test"
    | "n2-confounder-audit";
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
    edgeScanRequiresMetricsPass: true;
    historicalTestRequiresEdgeScanPass: true;
    confounderAuditRequiresHistoricalTestPass: true;
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

function dormant(
  taskId: N2DormantTaskId,
  taskStatuses: Record<N2DormantTaskId, N2DormantTaskStatus>,
  catalogDefaultStatuses: Record<N2DormantTaskId, string>,
  runtimeExecutorRegistered: Record<N2DormantTaskId, boolean>,
): boolean {
  return taskStatuses[taskId] === "BLOCKED_EXECUTOR_PENDING"
    && catalogDefaultStatuses[taskId] === "BLOCKED_EXECUTOR_PENDING"
    && !runtimeExecutorRegistered[taskId];
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
    N2_DORMANT_TASKS.map((taskId) => [taskId, input.catalogDefaultStatuses[taskId] ?? "UNKNOWN"]),
  ) as Record<N2DormantTaskId, string>;
  const runtimeExecutorRegistered = Object.fromEntries(
    N2_DORMANT_TASKS.map((taskId) => [taskId, input.runtimeExecutorRegistered[taskId] === true]),
  ) as Record<N2DormantTaskId, boolean>;

  const blockers: string[] = [];
  for (const taskId of N2_DORMANT_TASKS) {
    const taskStatus = taskStatuses[taskId];
    const defaultStatus = catalogDefaultStatuses[taskId];
    const registered = runtimeExecutorRegistered[taskId];
    if (defaultStatus === "BLOCKED_EXECUTOR_PENDING" && registered) {
      blockers.push(`${taskId}:REGISTERED_WHILE_BLOCKED_EXECUTOR_PENDING`);
    }
    if (defaultStatus !== "BLOCKED_EXECUTOR_PENDING" && !registered && taskStatus !== "PASS") {
      blockers.push(`${taskId}:CATALOG_ACTIVATED_WITHOUT_EXECUTOR`);
    }
    if (taskStatus === "BLOCKED_EXECUTOR_PENDING"
      && defaultStatus !== "BLOCKED_EXECUTOR_PENDING"
      && registered) {
      blockers.push(`${taskId}:QUEUE_DORMANT_WHILE_CATALOG_AND_EXECUTOR_ACTIVE`);
    }
  }

  const baseline020Pass = taskStatuses["TASK-N2-020"] === "PASS";
  const baseline021Pass = taskStatuses["TASK-N2-021"] === "PASS";
  const baseline020Dormant = dormant("TASK-N2-020", taskStatuses, catalogDefaultStatuses, runtimeExecutorRegistered);
  const baseline021Dormant = dormant("TASK-N2-021", taskStatuses, catalogDefaultStatuses, runtimeExecutorRegistered);
  if (baseline020Dormant !== baseline021Dormant) blockers.push("BASELINE_PAIR_ACTIVATION_STATE_DIVERGED");
  if (baseline020Pass !== baseline021Pass) blockers.push("BASELINE_PAIR_PASS_STATE_DIVERGED");
  if (taskStatuses["TASK-N2-022"] === "PASS" && !(baseline020Pass && baseline021Pass)) {
    blockers.push("COMMON_COHORT_PASS_WITHOUT_BOTH_BASELINES_PASS");
  }
  if (taskStatuses["TASK-N2-030"] === "PASS" && taskStatuses["TASK-N2-022"] !== "PASS") {
    blockers.push("METRICS_PASS_WITHOUT_COMMON_COHORT_PASS");
  }
  if (taskStatuses["TASK-N2-040"] === "PASS" && taskStatuses["TASK-N2-030"] !== "PASS") {
    blockers.push("EDGE_SCAN_PASS_WITHOUT_METRICS_PASS");
  }
  if (taskStatuses["TASK-N2-041"] === "PASS" && taskStatuses["TASK-N2-040"] !== "PASS") {
    blockers.push("HISTORICAL_TEST_PASS_WITHOUT_EDGE_SCAN_PASS");
  }
  if (taskStatuses["TASK-N2-042"] === "PASS" && taskStatuses["TASK-N2-041"] !== "PASS") {
    blockers.push("CONFOUNDER_AUDIT_PASS_WITHOUT_HISTORICAL_TEST_PASS");
  }

  let stage: N2DormantActivationStage;
  let activationActions: N2DormantActivationAction[] = [];
  if (blockers.length > 0) {
    stage = "CONFLICT";
  } else if (taskStatuses["TASK-N2-042"] === "PASS") {
    stage = "COMPLETE";
  } else if (taskStatuses["TASK-N2-041"] === "PASS") {
    if (dormant("TASK-N2-042", taskStatuses, catalogDefaultStatuses, runtimeExecutorRegistered)) {
      stage = "ACTIVATE_CONFOUNDER_AUDIT";
      activationActions = [action("n2-confounder-audit", ["TASK-N2-042"])];
    } else {
      stage = "WAITING_CONFOUNDER_AUDIT_PASS";
    }
  } else if (taskStatuses["TASK-N2-040"] === "PASS") {
    if (dormant("TASK-N2-041", taskStatuses, catalogDefaultStatuses, runtimeExecutorRegistered)) {
      stage = "ACTIVATE_HISTORICAL_TEST";
      activationActions = [action("n2-historical-test", ["TASK-N2-041"])];
    } else {
      stage = "WAITING_HISTORICAL_TEST_PASS";
    }
  } else if (taskStatuses["TASK-N2-030"] === "PASS") {
    if (dormant("TASK-N2-040", taskStatuses, catalogDefaultStatuses, runtimeExecutorRegistered)) {
      stage = "ACTIVATE_EDGE_SCAN";
      activationActions = [action("n2-edge-scan", ["TASK-N2-040"])];
    } else {
      stage = "WAITING_EDGE_SCAN_PASS";
    }
  } else if (taskStatuses["TASK-N2-022"] === "PASS") {
    if (dormant("TASK-N2-030", taskStatuses, catalogDefaultStatuses, runtimeExecutorRegistered)) {
      stage = "ACTIVATE_METRICS";
      activationActions = [action("n2-metrics", ["TASK-N2-030"])];
    } else {
      stage = "WAITING_METRICS_PASS";
    }
  } else if (baseline020Pass && baseline021Pass) {
    if (dormant("TASK-N2-022", taskStatuses, catalogDefaultStatuses, runtimeExecutorRegistered)) {
      stage = "ACTIVATE_COMMON_COHORT";
      activationActions = [action("n2-common-cohort", ["TASK-N2-022"])];
    } else {
      stage = "WAITING_COMMON_COHORT_PASS";
    }
  } else if (input.readinessStatus === "READY_FOR_N2_020") {
    const bothDormant = baseline020Dormant && baseline021Dormant;
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
      edgeScanRequiresMetricsPass: true as const,
      historicalTestRequiresEdgeScanPass: true as const,
      confounderAuditRequiresHistoricalTestPass: true as const,
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

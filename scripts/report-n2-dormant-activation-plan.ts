import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { isExecutorImplemented } from "../src/automation/taskExecutors";
import {
  validateCatalog,
  validateQueueState,
} from "../src/automation/taskCatalog";
import {
  N2_DORMANT_TASKS,
} from "../src/automation/n2DormantActivationContract";
import {
  buildN2DormantActivationReport,
} from "../src/automation/n2DormantActivationReport";
import {
  buildN2MarketBaselineReadinessReport,
} from "../src/research-replay/n2MarketBaselineReadiness";
import {
  readN2MarketBaselineReadiness,
} from "../src/research-replay/n2MarketBaselineReadinessReader";

type AutomationPolicy = { dataRoot?: unknown };

function arg(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const repoRoot = resolve(process.cwd());
const policy = JSON.parse(
  readFileSync(resolve(repoRoot, "config/research-automation-policy.json"), "utf8"),
) as AutomationPolicy;
const configuredDataRoot = process.env.BOAT_PON_DATA_ROOT?.trim()
  || (typeof policy.dataRoot === "string" ? policy.dataRoot.trim() : "")
  || repoRoot;
const dataRoot = resolve(configuredDataRoot);
const sidecarDbPath = resolve(
  process.env.BOAT_PON_RESEARCH_REPLAY_DB?.trim()
    || resolve(dataRoot, "data/research-replay.sqlite"),
);
const statePath = resolve(arg("state") ?? resolve(repoRoot, "automation/control/task-queue-state.json"));

const catalogRaw = JSON.parse(readFileSync(resolve(repoRoot, "automation/task-catalog.json"), "utf8"));
const catalogValidation = validateCatalog(catalogRaw);
if (!catalogValidation.valid || !catalogValidation.catalog) {
  console.log(JSON.stringify({
    reportVersion: "n2-dormant-activation-report-v1",
    status: "CONFLICT",
    stage: "CONFLICT",
    blockers: ["CATALOG_INVALID", ...catalogValidation.errors],
    activationActions: [],
    activationPlanningAttemptDelta: 0,
    automaticMutationAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
    automatedBettingAuthorized: false,
    productionApplyAuthorized: false,
    databaseWriteCount: 0,
    networkRequestCount: 0,
    rawOddsValuesReadByPlanner: false,
  }, null, 2));
  process.exitCode = 3;
} else {
  let stateRaw: unknown;
  try {
    stateRaw = JSON.parse(readFileSync(statePath, "utf8"));
  } catch (error) {
    console.log(JSON.stringify({
      reportVersion: "n2-dormant-activation-report-v1",
      status: "CONFLICT",
      stage: "CONFLICT",
      blockers: [`QUEUE_STATE_READ_FAILED:${error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN"}`],
      activationActions: [],
      activationPlanningAttemptDelta: 0,
      automaticMutationAuthorized: false,
      currentBuyConnectionAuthorized: false,
      lineConnectionAuthorized: false,
      publicPublishAuthorized: false,
      automatedBettingAuthorized: false,
      productionApplyAuthorized: false,
      databaseWriteCount: 0,
      networkRequestCount: 0,
      rawOddsValuesReadByPlanner: false,
    }, null, 2));
    process.exitCode = 3;
  }

  if (stateRaw !== undefined) {
    const stateValidation = validateQueueState(stateRaw);
    if (!stateValidation.valid || !stateValidation.state) {
      console.log(JSON.stringify({
        reportVersion: "n2-dormant-activation-report-v1",
        status: "CONFLICT",
        stage: "CONFLICT",
        blockers: ["QUEUE_STATE_INVALID", ...stateValidation.errors],
        activationActions: [],
        activationPlanningAttemptDelta: 0,
        automaticMutationAuthorized: false,
        currentBuyConnectionAuthorized: false,
        lineConnectionAuthorized: false,
        publicPublishAuthorized: false,
        automatedBettingAuthorized: false,
        productionApplyAuthorized: false,
        databaseWriteCount: 0,
        networkRequestCount: 0,
        rawOddsValuesReadByPlanner: false,
      }, null, 2));
      process.exitCode = 3;
    } else {
      const readinessRead = readN2MarketBaselineReadiness({ dataRoot, sidecarDbPath });
      const readiness = buildN2MarketBaselineReadinessReport({
        acceptedT5RaceKeys: readinessRead.acceptedT5RaceKeys,
        settledRaceKeys: readinessRead.settledRaceKeys,
        integrityBlockedRaceKeys: readinessRead.integrityBlockedRaceKeys,
        sourceBlockers: readinessRead.sourceBlockers,
      });
      const catalogTasks = catalogValidation.catalog.tasks
        .filter((task) => (N2_DORMANT_TASKS as readonly string[]).includes(task.taskId))
        .map((task) => ({ taskId: task.taskId, taskType: task.taskType, defaultStatus: task.defaultStatus }));
      const runtimeRegisteredByTaskId = Object.fromEntries(catalogTasks.map((task) => [
        task.taskId,
        isExecutorImplemented(task.taskType),
      ]));
      const queueTasks = Object.fromEntries(N2_DORMANT_TASKS.map((taskId) => {
        const state = stateValidation.state!.tasks[taskId];
        return [taskId, state ? {
          status: state.status,
          attemptCount: state.attemptCount,
          maxAttempts: state.maxAttempts,
        } : undefined];
      }));
      const report = buildN2DormantActivationReport({
        readiness,
        catalogTasks,
        queueTasks,
        runtimeRegisteredByTaskId,
      });
      console.log(JSON.stringify(report, null, 2));
      if (report.status === "CONFLICT" || readiness.status === "BLOCKED") process.exitCode = 3;
    }
  }
}
